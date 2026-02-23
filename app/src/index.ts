import { Hono, type Context, type Next } from 'hono'
import { cors } from 'hono/cors'
import PostalMime from "postal-mime";

type Bindings = {
  DB: D1Database
  NOTIFICATION: Fetcher
  KV: KVNamespace
  R2: R2Bucket
  QUEUE: Queue
  ALLOWED_EMAILS: string
  ADMIN_API_TOKEN: string
  TURNSTILE_SECRET_KEY: string
  TURNSTILE_SITE_KEY: string
};

type SubscriberInput = {
  email: string
  firstName?: string | null
  lastName?: string | null
}

type SubscriptionAction = 'confirm' | 'cancel'

type SubscriptionTokenPayload = {
  action?: SubscriptionAction
  email?: string
  newsletterId?: string
  firstName?: string | null
  lastName?: string | null
}

const NOTIFICATION_BASE_URL = 'http://haben-notification'
const D1_BATCH_LIMIT = 100
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const INTERNAL_ERROR_MESSAGE = 'Internal server error'
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const RATE_LIMIT_GC_SAMPLE_RATE = 0.01
const PRE_TURNSTILE_MAX_REQUESTS = 30
const PRE_TURNSTILE_WINDOW_SECONDS = 60
const POST_TURNSTILE_IP_MAX_REQUESTS = 20
const POST_TURNSTILE_TARGET_MAX_REQUESTS = 3
const POST_TURNSTILE_WINDOW_SECONDS = 60 * 60
const MISSING_ABUSE_EVENT_TABLE_FRAGMENT = 'no such table: AbuseEvent'

let hasLoggedMissingAbuseEventMigration = false

export const app = new Hono<{ Bindings: Bindings }>()
type AppContext = Context<{ Bindings: Bindings }>

// HTML escaping to prevent XSS
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// Parse and clamp pagination parameters
function parsePagination(query: { page?: string, limit?: string }) {
  const page = Math.max(1, parseInt(query.page || '1') || 1)
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || '50') || 50))
  const offset = (page - 1) * limit
  return { page, limit, offset }
}

function normalizeOptionalName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim().toLowerCase()
  return EMAIL_REGEX.test(normalized) ? normalized : null
}

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value)
}

function getClientIp(c: AppContext): string {
  const cfConnectingIp = c.req.header('CF-Connecting-IP')
  if (cfConnectingIp) {
    return cfConnectingIp
  }
  const forwardedFor = c.req.header('X-Forwarded-For')
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim()
  }
  return 'unknown'
}

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const first = encoder.encode(a)
  const second = encoder.encode(b)

  if (first.length !== second.length) {
    return false
  }

  let mismatch = 0
  for (let i = 0; i < first.length; i += 1) {
    mismatch |= first[i] ^ second[i]
  }
  return mismatch === 0
}

function getBearerToken(authorization: string | undefined): string | null {
  if (!authorization) {
    return null
  }
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : null
}

function logError(scope: string, error: unknown) {
  if (error instanceof Error) {
    console.error(`[${scope}] ${error.message}`, error.stack)
    return
  }
  console.error(`[${scope}]`, error)
}

function internalServerError(c: AppContext, scope: string, error: unknown) {
  logError(scope, error)
  return c.json({ error: INTERNAL_ERROR_MESSAGE }, 500)
}

function parseSubscriptionToken(tokenString: string): SubscriptionTokenPayload | null {
  try {
    const payload = JSON.parse(tokenString) as SubscriptionTokenPayload
    return payload && typeof payload === 'object' ? payload : null
  } catch {
    return null
  }
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  const bytes = new Uint8Array(digest)
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function cleanupRateLimitEvents(db: D1Database): Promise<void> {
  try {
    await db.prepare(
      `DELETE FROM AbuseEvent WHERE createdAt < ?`
    ).bind(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()).run()
  } catch (error: unknown) {
    logError('rate-limit-cleanup', error)
  }
}

function isMissingAbuseEventTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes(MISSING_ABUSE_EVENT_TABLE_FRAGMENT)
}

function logMissingAbuseEventMigrationWarning() {
  if (hasLoggedMissingAbuseEventMigration) {
    return
  }
  hasLoggedMissingAbuseEventMigration = true
  console.error(
    '[rate-limit] AbuseEvent table is missing. Run db/20260223_add_abuse_event_table.sql before deploy. Bypassing subscription rate limits until migration is applied.'
  )
}

async function enforceRateLimit(
  db: D1Database,
  rule: { bucket: string, key: string, maxRequests: number, windowSeconds: number }
): Promise<boolean> {
  try {
    const now = Date.now()
    const keyHash = await sha256Hex(rule.key)
    const sinceIso = new Date(now - (rule.windowSeconds * 1000)).toISOString()
    const insertResult = await db.prepare(
      `INSERT INTO AbuseEvent (id, bucket, key_hash, createdAt)
       SELECT ?, ?, ?, ?
       WHERE (
         SELECT COUNT(*)
         FROM AbuseEvent
         WHERE bucket = ? AND key_hash = ? AND createdAt >= ?
       ) < ?`
    ).bind(
      crypto.randomUUID(),
      rule.bucket,
      keyHash,
      new Date(now).toISOString(),
      rule.bucket,
      keyHash,
      sinceIso,
      rule.maxRequests
    ).run()

    const inserted = Number(insertResult.meta.changes ?? 0) > 0
    if (!inserted) {
      return false
    }

    if (Math.random() < RATE_LIMIT_GC_SAMPLE_RATE) {
      await cleanupRateLimitEvents(db)
    }

    return true
  } catch (error: unknown) {
    // Fail open for public subscribe flows if migration has not been applied yet.
    if (isMissingAbuseEventTableError(error)) {
      logMissingAbuseEventMigrationWarning()
      return true
    }
    throw error
  }
}

async function verifyTurnstile(
  env: Bindings,
  token: string,
  remoteIp: string
): Promise<boolean> {
  if (!token || !env.TURNSTILE_SECRET_KEY) {
    return false
  }

  const body = new URLSearchParams()
  body.set('secret', env.TURNSTILE_SECRET_KEY)
  body.set('response', token)
  if (remoteIp !== 'unknown') {
    body.set('remoteip', remoteIp)
  }

  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    return false
  }

  const result = await response.json() as { success?: boolean }
  return result.success === true
}

app.use('/api/subscribe/*', cors({
  origin: 'https://habengirma.com',
  allowMethods: ['POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  maxAge: 86400,
}))

const adminAuthMiddleware = async (c: AppContext, next: Next) => {
  if (c.req.method === 'OPTIONS') {
    await next()
    return
  }

  const adminApiToken = c.env.ADMIN_API_TOKEN?.trim()
  if (!adminApiToken) {
    logError('admin-auth', new Error('ADMIN_API_TOKEN secret is not configured'))
    return c.json({ error: 'Admin API unavailable' }, 503)
  }

  const requestToken = getBearerToken(c.req.header('Authorization'))
  if (!requestToken || !timingSafeEqual(requestToken, adminApiToken)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await next()
}

app.use('/api/newsletter', adminAuthMiddleware)
app.use('/api/newsletter/*', adminAuthMiddleware)

// Private Routes for managing Newsletters
// Protected by Cloudflare Access policy at the edge
app.post('/api/newsletter', async (c) => {
  const { title, description, logo = null } = await c.req.json<{ title: string, description: string, logo?: string | null }>()

  const id = crypto.randomUUID()

  const createdAt = new Date().toISOString()
  const updatedAt = createdAt

  await c.env.R2.put(`newsletters/${id}/index.md`, `# ${title}\n\n${description}`)

  try {
    await c.env.DB.prepare(
      `INSERT INTO Newsletter (id, title, description, logo, subscribable, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, title, description, logo, 1, createdAt, updatedAt).run()

    return c.json({ id, title, description, logo, subscribable: true, subscriberCount: 0, createdAt, updatedAt }, 201)
  } catch (error: unknown) {
    return internalServerError(c, 'create-newsletter', error)
  }
})

app.put('/api/newsletter/:newsletterId/offline', async (c) => {
  const { newsletterId } = c.req.param()

  try {
    await c.env.DB.prepare(
      `UPDATE Newsletter SET subscribable = ? WHERE id = ?`
    ).bind(0, newsletterId).run()

    return c.json({ message: 'Newsletter taken offline successfully' })
  } catch (error: unknown) {
    return internalServerError(c, 'set-newsletter-offline', error)
  }
})

app.put('/api/newsletter/:newsletterId/online', async (c) => {
  const { newsletterId } = c.req.param()

  try {
    await c.env.DB.prepare(
      `UPDATE Newsletter SET subscribable = ? WHERE id = ?`
    ).bind(1, newsletterId).run()

    return c.json({ message: 'Newsletter brought online successfully' })
  } catch (error: unknown) {
    return internalServerError(c, 'set-newsletter-online', error)
  }
})

// List all newsletters with subscriber counts
app.get('/api/newsletter', async (c) => {
  const { page, limit, offset } = parsePagination({
    page: c.req.query('page'),
    limit: c.req.query('limit'),
  })

  try {
    const countResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM Newsletter`
    ).first<{ total: number }>()
    const total = countResult?.total ?? 0

    const { results } = await c.env.DB.prepare(
      `SELECT n.*, COUNT(s.email) as subscriberCount
       FROM Newsletter n
       LEFT JOIN Subscriber s ON n.id = s.newsletter_id AND s.isSubscribed = 1
       GROUP BY n.id
       ORDER BY n.createdAt DESC
       LIMIT ? OFFSET ?`
    ).bind(limit, offset).all()

    return c.json({ newsletters: results, pagination: { page, limit, total } })
  } catch (error: unknown) {
    return internalServerError(c, 'list-newsletters', error)
  }
})

// Get single newsletter with subscriber count
app.get('/api/newsletter/:newsletterId', async (c) => {
  const { newsletterId } = c.req.param()

  try {
    const newsletter = await c.env.DB.prepare(
      `SELECT n.*, COUNT(s.email) as subscriberCount
       FROM Newsletter n
       LEFT JOIN Subscriber s ON n.id = s.newsletter_id AND s.isSubscribed = 1
       WHERE n.id = ?
       GROUP BY n.id`
    ).bind(newsletterId).first()

    if (!newsletter) {
      return c.json({ error: 'Newsletter not found' }, 404)
    }

    return c.json(newsletter)
  } catch (error: unknown) {
    return internalServerError(c, 'get-newsletter', error)
  }
})

// Update newsletter (partial update)
app.put('/api/newsletter/:newsletterId', async (c) => {
  const { newsletterId } = c.req.param()
  const body = await c.req.json<{ title?: string, description?: string, logo?: string | null }>()

  try {
    const existing = await c.env.DB.prepare(
      `SELECT * FROM Newsletter WHERE id = ?`
    ).bind(newsletterId).first()

    if (!existing) {
      return c.json({ error: 'Newsletter not found' }, 404)
    }

    const title = body.title ?? existing.title as string
    const description = body.description ?? existing.description as string
    const logo = body.logo !== undefined ? body.logo : existing.logo as string | null
    const updatedAt = new Date().toISOString()

    await c.env.DB.prepare(
      `UPDATE Newsletter SET title = ?, description = ?, logo = ?, updatedAt = ? WHERE id = ?`
    ).bind(title, description, logo, updatedAt, newsletterId).run()

    await c.env.R2.put(`newsletters/${newsletterId}/index.md`, `# ${title}\n\n${description}`)

    const subscriberCount = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM Subscriber WHERE newsletter_id = ? AND isSubscribed = 1`
    ).bind(newsletterId).first<{ count: number }>()

    return c.json({
      id: newsletterId, title, description, logo,
      subscribable: existing.subscribable,
      subscriberCount: subscriberCount?.count ?? 0,
      createdAt: existing.createdAt, updatedAt
    })
  } catch (error: unknown) {
    return internalServerError(c, 'update-newsletter', error)
  }
})

// Delete newsletter + subscribers + R2 cleanup
app.delete('/api/newsletter/:newsletterId', async (c) => {
  const { newsletterId } = c.req.param()

  try {
    const existing = await c.env.DB.prepare(
      `SELECT id FROM Newsletter WHERE id = ?`
    ).bind(newsletterId).first()

    if (!existing) {
      return c.json({ error: 'Newsletter not found' }, 404)
    }

    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM Subscriber WHERE newsletter_id = ?`).bind(newsletterId),
      c.env.DB.prepare(`DELETE FROM Newsletter WHERE id = ?`).bind(newsletterId),
    ])

    // Best-effort R2 cleanup with cursor pagination
    try {
      let cursor: string | undefined
      do {
        const objects = await c.env.R2.list({ prefix: `newsletters/${newsletterId}/`, cursor })
        if (objects.objects.length > 0) {
          await Promise.all(objects.objects.map(obj => c.env.R2.delete(obj.key)))
        }
        cursor = objects.truncated ? objects.cursor : undefined
      } while (cursor)
    } catch {
      // R2 cleanup is best-effort
    }

    return c.json({ message: 'Newsletter deleted successfully' })
  } catch (error: unknown) {
    return internalServerError(c, 'delete-newsletter', error)
  }
})

// List subscribers for a newsletter
app.get('/api/newsletter/:newsletterId/subscribers', async (c) => {
  const { newsletterId } = c.req.param()
  const { page, limit, offset } = parsePagination({
    page: c.req.query('page'),
    limit: c.req.query('limit'),
  })

  try {
    const newsletter = await c.env.DB.prepare(
      `SELECT id FROM Newsletter WHERE id = ?`
    ).bind(newsletterId).first()

    if (!newsletter) {
      return c.json({ error: 'Newsletter not found' }, 404)
    }

    const countResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM Subscriber WHERE newsletter_id = ?`
    ).bind(newsletterId).first<{ total: number }>()
    const total = countResult?.total ?? 0

    const { results } = await c.env.DB.prepare(
      `SELECT * FROM Subscriber WHERE newsletter_id = ? ORDER BY upsertedAt DESC LIMIT ? OFFSET ?`
    ).bind(newsletterId, limit, offset).all()

    return c.json({ subscribers: results, pagination: { page, limit, total } })
  } catch (error: unknown) {
    return internalServerError(c, 'list-subscribers', error)
  }
})

// Add subscriber(s) to a newsletter
app.post('/api/newsletter/:newsletterId/subscribers', async (c) => {
  const { newsletterId } = c.req.param()
  const { subscribers } = await c.req.json<{ subscribers: SubscriberInput[] }>()

  if (!subscribers || !Array.isArray(subscribers) || subscribers.length === 0) {
    return c.json({ error: 'subscribers array is required' }, 400)
  }

  const normalizedSubscribers: Array<{
    email: string
    firstName: string | null
    lastName: string | null
  }> = []

  for (const subscriber of subscribers) {
    if (!subscriber || typeof subscriber.email !== 'string') {
      return c.json({ error: 'Each subscriber must include an email field' }, 400)
    }
    const normalizedEmail = normalizeEmail(subscriber.email)
    if (!normalizedEmail) {
      return c.json({ error: `Invalid email: ${subscriber.email}` }, 400)
    }
    normalizedSubscribers.push({
      email: normalizedEmail,
      firstName: normalizeOptionalName(subscriber.firstName),
      lastName: normalizeOptionalName(subscriber.lastName),
    })
  }

  try {
    const newsletter = await c.env.DB.prepare(
      `SELECT id FROM Newsletter WHERE id = ?`
    ).bind(newsletterId).first()

    if (!newsletter) {
      return c.json({ error: 'Newsletter not found' }, 404)
    }

    // Chunk into batches to respect D1's 100-statement batch limit
    for (let i = 0; i < normalizedSubscribers.length; i += D1_BATCH_LIMIT) {
      const chunk = normalizedSubscribers.slice(i, i + D1_BATCH_LIMIT)
      const statements = chunk.map(({ email, firstName, lastName }) =>
        c.env.DB.prepare(
          `INSERT INTO Subscriber (email, first_name, last_name, newsletter_id, isSubscribed) VALUES (?, ?, ?, ?, 1)
           ON CONFLICT(email, newsletter_id) DO UPDATE SET
             isSubscribed = 1,
             first_name = COALESCE(excluded.first_name, Subscriber.first_name),
             last_name = COALESCE(excluded.last_name, Subscriber.last_name)`
        ).bind(email, firstName, lastName, newsletterId)
      )
      await c.env.DB.batch(statements)
    }

    return c.json({ message: `${normalizedSubscribers.length} subscriber(s) added` }, 201)
  } catch (error: unknown) {
    return internalServerError(c, 'add-subscribers', error)
  }
})

// Remove subscriber from a newsletter
app.delete('/api/newsletter/:newsletterId/subscribers/:email', async (c) => {
  const { newsletterId, email } = c.req.param()

  try {
    const subscriber = await c.env.DB.prepare(
      `SELECT email FROM Subscriber WHERE email = ? AND newsletter_id = ?`
    ).bind(email, newsletterId).first()

    if (!subscriber) {
      return c.json({ error: 'Subscriber not found' }, 404)
    }

    await c.env.DB.prepare(
      `DELETE FROM Subscriber WHERE email = ? AND newsletter_id = ?`
    ).bind(email, newsletterId).run()

    return c.json({ message: 'Subscriber removed successfully' })
  } catch (error: unknown) {
    return internalServerError(c, 'delete-subscriber', error)
  }
})

// Public Routes for managing Subscriptions
app.get('/api/subscribe/confirm/:token', async (c) => {
  const { token } = c.req.param()

  try {
    // Validate Token and Get Email
    const tokenString = await c.env.KV.get(token)
    if (!tokenString) {
      return c.json({ error: 'Invalid or expired token' }, 400)
    }

    const tokenPayload = parseSubscriptionToken(tokenString)
    if (!tokenPayload || tokenPayload.action !== 'confirm') {
      return c.json({ error: 'Invalid or expired token' }, 400)
    }

    const email = typeof tokenPayload.email === 'string' ? tokenPayload.email : ''
    const newsletterId = typeof tokenPayload.newsletterId === 'string' ? tokenPayload.newsletterId : ''

    if (!email || !newsletterId || !isValidUuid(newsletterId)) {
      return c.json({ error: 'Invalid or expired token' }, 400)
    }

    const firstName = normalizeOptionalName(tokenPayload.firstName)
    const lastName = normalizeOptionalName(tokenPayload.lastName)

    // Upsert Subscription
    await c.env.DB.prepare(
      `INSERT INTO Subscriber (email, first_name, last_name, newsletter_id, isSubscribed) VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(email, newsletter_id) DO UPDATE SET
         isSubscribed = 1,
         first_name = COALESCE(excluded.first_name, Subscriber.first_name),
         last_name = COALESCE(excluded.last_name, Subscriber.last_name)`
    ).bind(email, firstName, lastName, newsletterId).run()

    // Enforce one-time use semantics for confirmation links.
    await c.env.KV.delete(token)

    return c.redirect('https://habengirma.com/subscription-successful/')
  } catch (error: unknown) {
    return internalServerError(c, 'confirm-subscription', error)
  }
})

app.get('/api/subscribe/cancel/:token', async (c) => {
  const { token } = c.req.param()

  try {
    // Validate Token and Get Email
    const tokenString = await c.env.KV.get(token)
    if (!tokenString) {
      return c.json({ error: 'Invalid or expired token' }, 400)
    }

    const tokenPayload = parseSubscriptionToken(tokenString)
    if (!tokenPayload || tokenPayload.action !== 'cancel') {
      return c.json({ error: 'Invalid or expired token' }, 400)
    }

    const email = typeof tokenPayload.email === 'string' ? tokenPayload.email : ''
    const newsletterId = typeof tokenPayload.newsletterId === 'string' ? tokenPayload.newsletterId : ''

    if (!email || !newsletterId || !isValidUuid(newsletterId)) {
      return c.json({ error: 'Invalid or expired token' }, 400)
    }

    // Update Subscription Status
    await c.env.DB.prepare(
      `UPDATE Subscriber SET isSubscribed = 0 WHERE email = ? AND newsletter_id = ?`
    ).bind(email, newsletterId).run()

    // Enforce one-time use semantics for cancellation links.
    await c.env.KV.delete(token)

    return renderHtml(c, 'Unsubscribed successfully', '取消订阅成功')
  } catch (error: unknown) {
    return internalServerError(c, 'cancel-subscription', error)
  }
})

app.post('/api/subscribe/send-confirmation', async (c) => {
  try {
    const body = await c.req.json<{
      email: string
      newsletterId: string
      turnstileToken: string
      firstName?: string | null
      lastName?: string | null
    }>()
    const email = normalizeEmail(body.email)
    const newsletterId = body.newsletterId?.trim()
    const turnstileToken = typeof body.turnstileToken === 'string' ? body.turnstileToken.trim() : ''
    const firstName = normalizeOptionalName(body.firstName)
    const lastName = normalizeOptionalName(body.lastName)

    if (!email || !newsletterId || !turnstileToken) {
      return c.json({ error: 'email, newsletterId and turnstileToken are required' }, 400)
    }
    if (!isValidUuid(newsletterId)) {
      return c.json({ error: 'Invalid newsletterId' }, 400)
    }

    const requestIp = getClientIp(c)
    const preTurnstileIpAllowed = await enforceRateLimit(c.env.DB, {
      bucket: 'subscribe-confirmation-precheck-ip',
      key: requestIp,
      maxRequests: PRE_TURNSTILE_MAX_REQUESTS,
      windowSeconds: PRE_TURNSTILE_WINDOW_SECONDS,
    })
    if (!preTurnstileIpAllowed) {
      c.header('Retry-After', String(PRE_TURNSTILE_WINDOW_SECONDS))
      return c.json({ error: 'Too many requests' }, 429)
    }

    const turnstilePassed = await verifyTurnstile(c.env, turnstileToken, requestIp)
    if (!turnstilePassed) {
      return c.json({ error: 'Bot verification failed' }, 403)
    }

    const newsletter = await c.env.DB.prepare(
      `SELECT id, subscribable FROM Newsletter WHERE id = ?`
    ).bind(newsletterId).first<{ id: string, subscribable: number }>()
    if (!newsletter) {
      return c.json({ error: 'Newsletter not found' }, 404)
    }
    if (!newsletter.subscribable) {
      return c.json({ error: 'Newsletter is not subscribable' }, 409)
    }

    const ipAllowed = await enforceRateLimit(c.env.DB, {
      bucket: 'subscribe-confirmation-ip',
      key: requestIp,
      maxRequests: POST_TURNSTILE_IP_MAX_REQUESTS,
      windowSeconds: POST_TURNSTILE_WINDOW_SECONDS,
    })
    if (!ipAllowed) {
      c.header('Retry-After', String(POST_TURNSTILE_WINDOW_SECONDS))
      return c.json({ error: 'Too many requests' }, 429)
    }

    const targetAllowed = await enforceRateLimit(c.env.DB, {
      bucket: 'subscribe-confirmation-target',
      key: `${newsletterId}:${email}`,
      maxRequests: POST_TURNSTILE_TARGET_MAX_REQUESTS,
      windowSeconds: POST_TURNSTILE_WINDOW_SECONDS,
    })
    if (!targetAllowed) {
      c.header('Retry-After', String(POST_TURNSTILE_WINDOW_SECONDS))
      return c.json({ error: 'Too many requests' }, 429)
    }

    const token = crypto.randomUUID()
    const expiry = 60 * 60 // 1 hour in seconds

    // Store Token
    await c.env.KV.put(
      token,
      JSON.stringify({ action: 'confirm', email, newsletterId, firstName, lastName }),
      { expirationTtl: expiry }
    )

    // Send Confirmation Email
    const confirmationUrl = `https://newsletter.habengirma.com/api/subscribe/confirm/${token}`

    await sendEmail(c.env, email, 'Confirm your subscription', `Please confirm your subscription by clicking the following link: ${confirmationUrl}`)
    return c.json({ message: 'Confirmation email sent' })
  } catch (error: unknown) {
    return internalServerError(c, 'send-confirmation-email', error)
  }
})

app.post('/api/subscribe/send-cancellation', async (c) => {
  try {
    const body = await c.req.json<{ email: string, newsletterId: string, turnstileToken: string }>()
    const email = normalizeEmail(body.email)
    const newsletterId = typeof body.newsletterId === 'string' ? body.newsletterId.trim() : ''
    const turnstileToken = typeof body.turnstileToken === 'string' ? body.turnstileToken.trim() : ''

    if (!email || !newsletterId || !turnstileToken) {
      return c.json({ error: 'email, newsletterId and turnstileToken are required' }, 400)
    }
    if (!isValidUuid(newsletterId)) {
      return c.json({ error: 'Invalid newsletterId' }, 400)
    }

    const requestIp = getClientIp(c)
    const preTurnstileIpAllowed = await enforceRateLimit(c.env.DB, {
      bucket: 'subscribe-cancellation-precheck-ip',
      key: requestIp,
      maxRequests: PRE_TURNSTILE_MAX_REQUESTS,
      windowSeconds: PRE_TURNSTILE_WINDOW_SECONDS,
    })
    if (!preTurnstileIpAllowed) {
      c.header('Retry-After', String(PRE_TURNSTILE_WINDOW_SECONDS))
      return c.json({ error: 'Too many requests' }, 429)
    }

    const turnstilePassed = await verifyTurnstile(c.env, turnstileToken, requestIp)
    if (!turnstilePassed) {
      return c.json({ error: 'Bot verification failed' }, 403)
    }

    const newsletter = await c.env.DB.prepare(
      `SELECT id FROM Newsletter WHERE id = ?`
    ).bind(newsletterId).first<{ id: string }>()
    if (!newsletter) {
      return c.json({ error: 'Newsletter not found' }, 404)
    }

    const ipAllowed = await enforceRateLimit(c.env.DB, {
      bucket: 'subscribe-cancellation-ip',
      key: requestIp,
      maxRequests: POST_TURNSTILE_IP_MAX_REQUESTS,
      windowSeconds: POST_TURNSTILE_WINDOW_SECONDS,
    })
    if (!ipAllowed) {
      c.header('Retry-After', String(POST_TURNSTILE_WINDOW_SECONDS))
      return c.json({ error: 'Too many requests' }, 429)
    }

    const targetAllowed = await enforceRateLimit(c.env.DB, {
      bucket: 'subscribe-cancellation-target',
      key: `${newsletterId}:${email}`,
      maxRequests: POST_TURNSTILE_TARGET_MAX_REQUESTS,
      windowSeconds: POST_TURNSTILE_WINDOW_SECONDS,
    })
    if (!targetAllowed) {
      c.header('Retry-After', String(POST_TURNSTILE_WINDOW_SECONDS))
      return c.json({ error: 'Too many requests' }, 429)
    }

    const token = crypto.randomUUID()
    const expiry = 60 * 60 // 1 hour in seconds

    // Store Token
    await c.env.KV.put(token, JSON.stringify({ action: 'cancel', email, newsletterId }), { expirationTtl: expiry })

    // Send Cancellation Email
    const cancellationUrl = `https://newsletter.habengirma.com/api/subscribe/cancel/${token}`

    await sendEmail(c.env, email, 'Cancel your subscription', `Please cancel your subscription by clicking the following link: ${cancellationUrl}`)
    return c.json({ message: 'Cancellation email sent' })
  } catch (error: unknown) {
    return internalServerError(c, 'send-cancellation-email', error)
  }
})

const sendEmail = async (env: Bindings, email: string, subject: string, txt: string, html: string = '') => {
  const res = await env.NOTIFICATION.fetch(
    new Request(`${NOTIFICATION_BASE_URL}/send_email`, {
      method: 'POST',
      body: JSON.stringify({ mail_to: email, subject, txt, html }),
      headers: { 'Content-Type': 'application/json' },
    })
  );

  if (!res.ok) {
    throw new Error(`Notification service returned status ${res.status}`)
  }

  const { message } = await res.json() as { message?: string };

  if (message !== 'success') {
    throw new Error(`Failed to send email to ${email}`);
  }
}

// Public Page for viewing Newsletters
app.get('/newsletter/:newsletterId', async (c) => {
  const { newsletterId } = c.req.param()

  try {
    const newsletter = await c.env.DB.prepare(
      `SELECT * FROM Newsletter WHERE id = ?`
    ).bind(newsletterId).first()

    if (!newsletter) {
      return c.html('<h1>Newsletter not found</h1>', 404)
    }

    if (!newsletter.subscribable) {
      return c.html('<h1>Newsletter is not subscribable</h1>', 404)
    }

    const safeTitle = escapeHtml(newsletter.title as string)
    const safeDescription = escapeHtml(newsletter.description as string)
    const safeLogo = escapeHtml((newsletter.logo as string) || '')
    const safeNewsletterId = escapeHtml(newsletterId)
    const safeTurnstileSiteKey = escapeHtml(c.env.TURNSTILE_SITE_KEY || '')

    const html = `
      <html>
        <head>
          <title>${safeTitle}</title>
          <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 0;
              padding: 0;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              background-color: #f4f4f4;
            }
            .container {
              background: white;
              padding: 20px;
              border-radius: 10px;
              box-shadow: 0 0 10px rgba(0,0,0,0.1);
              text-align: center;
              width: 90%;
              max-width: 600px;
            }
            img {
              max-width: 100%;
              height: auto;
            }
            h1 {
              margin: 20px 0;
            }
            p {
              font-size: 16px;
              color: #333;
            }
            .input-container {
              margin: 20px 0;
            }
            input[type="text"],
            input[type="email"] {
              padding: 10px;
              font-size: 16px;
              width: 80%;
              max-width: 400px;
              border: 1px solid #ccc;
              border-radius: 5px;
            }
            .button {
              display: inline-block;
              margin: 10px 5px;
              padding: 10px 20px;
              font-size: 16px;
              color: white;
              background-color: #007BFF;
              border: none;
              border-radius: 5px;
              text-decoration: none;
              cursor: pointer;
            }
            .button.cancel {
              background-color: #dc3545;
            }
            .message {
              margin-top: 20px;
              font-size: 16px;
              color: green;
            }
            .error {
              margin-top: 20px;
              font-size: 16px;
              color: red;
            }
            .captcha {
              margin: 20px auto;
              display: flex;
              justify-content: center;
            }
          </style>
          <script>
            function validateEmail(email) {
              const re = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/
              return re.test(email)
            }

            async function handleSubscribe(action) {
              const name = document.getElementById('name').value
              const email = document.getElementById('email').value
              const messageElement = document.getElementById('message')
              const errorElement = document.getElementById('error')

              messageElement.textContent = ''
              errorElement.textContent = ''

              if (!email || !validateEmail(email)) {
                errorElement.textContent = 'Please enter a valid email address.'
                return
              }

              const turnstileInput = document.querySelector('input[name="cf-turnstile-response"]')
              const turnstileToken = turnstileInput ? turnstileInput.value : ''
              if (!turnstileToken) {
                errorElement.textContent = 'Please complete bot verification.'
                return
              }

              function splitName(fullName) {
                const trimmed = fullName.trim()
                if (!trimmed) {
                  return { firstName: null, lastName: null }
                }
                const parts = trimmed.split(/\\s+/)
                return {
                  firstName: parts[0] || null,
                  lastName: parts.length > 1 ? parts.slice(1).join(' ') : null
                }
              }

              try {
                const payload = { email, newsletterId: '${safeNewsletterId}', turnstileToken }
                if (action === 'send-confirmation') {
                  const split = splitName(name)
                  if (split.firstName) {
                    payload.firstName = split.firstName
                  }
                  if (split.lastName) {
                    payload.lastName = split.lastName
                  }
                }
                const response = await fetch(\`/api/subscribe/\${action}\`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify(payload)
                })

                if (response.ok) {
                  messageElement.textContent = 'Operation successful, please check your email.'
                } else {
                  const result = await response.json()
                  errorElement.textContent = result.error || 'Operation failed, please try again.'
                }
                if (window.turnstile) {
                  window.turnstile.reset()
                }
              } catch (error) {
                errorElement.textContent = 'Request failed, please check your network connection.'
              }
            }
          </script>
        </head>
        <body>
          <div class="container">
            <img src="${safeLogo}" alt="${safeTitle} Logo" />
            <h1>${safeTitle}</h1>
            <p>${safeDescription}</p>
            <div class="input-container">
              <input type="text" id="name" placeholder="Enter your name (optional)" />
            </div>
            <div class="input-container">
              <input type="email" id="email" placeholder="Enter your email address" />
            </div>
            <div class="captcha">
              <div class="cf-turnstile" data-sitekey="${safeTurnstileSiteKey}"></div>
            </div>
            <button class="button" onclick="handleSubscribe('send-confirmation')">Subscribe</button>
            <button class="button cancel" onclick="handleSubscribe('send-cancellation')">Unsubscribe</button>
            <p id="message" class="message"></p>
            <p id="error" class="error"></p>
          </div>
        </body>
      </html>
    `

    return c.html(html)
  } catch (error: unknown) {
    logError('render-newsletter-page', error)
    return c.html('<h1>Internal server error</h1>', 500)
  }
})

// Common Functions

function renderHtml(
  c: AppContext,
  englishMessage: string,
  chineseMessage: string = englishMessage
) {
  const language = c.req.header('Accept-Language')?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  const message = language === 'zh' ? chineseMessage : englishMessage
  const safeMessage = escapeHtml(message)
  const html = `
    <!DOCTYPE html>
    <html lang="${language}">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${safeMessage}</title>
      </head>
      <body>
        <h1>${safeMessage}</h1>
      </body>
    </html>
  `

  return c.html(html)
}

const streamToArrayBuffer = async function (stream: ReadableStream, streamSize: number) {
  let result = new Uint8Array(streamSize);
  let bytesRead = 0;
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    result.set(value, bytesRead);
    bytesRead += value.length;
  }
  return result;
}

async function getSubscribers(newsletterId: string, db: D1Database): Promise<{ email: string }[]> {
  const { results } = await db.prepare(`SELECT email FROM Subscriber WHERE newsletter_id = ? AND isSubscribed = 1`).bind(newsletterId).all();
  return results as { email: string }[];
}

export default {
  fetch: app.fetch,
  async email(message: ForwardableEmailMessage, env: Bindings, ctx: ExecutionContext) {
    const allowedEmails = env.ALLOWED_EMAILS
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0)
    const sender = message.from.trim().toLowerCase()

    if (allowedEmails.indexOf(sender) === -1) {
      message.setReject("Address not allowed");
      return;
    }

    const subject = message.headers.get('subject') ?? '';

    console.log(`Processing email with subject: ${subject}`);

    const newsletterIdMatch = subject.match(/\[Newsletter-ID:([a-f0-9-]{36})\]/);
    const newsletterId = newsletterIdMatch ? newsletterIdMatch[1] : null;

    const realSubject = subject.replace(/\[Newsletter-ID:[a-f0-9-]{36}\]/, '').trim();

    if (!newsletterId) {
      message.setReject("No Newsletter ID found in subject");
      return;
    }

    const rawEmail = await streamToArrayBuffer(message.raw, message.rawSize);
    const parser = new PostalMime();
    const parsedEmail = await parser.parse(rawEmail);
    if (!parsedEmail.html || !parsedEmail.text) {
      console.error(`Can not parse email`);
      return;
    }

    const fileName = `newsletters/${newsletterId}/${Date.now()}.html`;

    await env.R2.put(fileName, parsedEmail.html);

    const subscribers = await getSubscribers(newsletterId, env.DB);

    for (const subscriber of subscribers) {
      await env.QUEUE.send({
        email: subscriber.email,
        newsletterId,
        subject: realSubject,
        fileName
      });
    }
  },
  async queue(batch: MessageBatch<{ email: string, newsletterId: string, subject: string, fileName: string }>, env: Bindings): Promise<void> {
    for (const message of batch.messages) {
      const { email, subject, newsletterId, fileName } = message.body;

      console.log(`Sending email to ${email} for newsletter ${newsletterId}`);

      try {
        const object = await env.R2.get(fileName);
        if (!object) throw new Error('Failed to get HTML content from R2');

        const htmlContent = await object.text();

        await sendEmail(env, email, subject, '', htmlContent);
        console.log(`Email sent to ${email}`);
      } catch (error: unknown) {
        console.error(`Failed to send email to ${email}:`, error);
      }
    }
  }
}
