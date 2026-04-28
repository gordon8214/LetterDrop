import { beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { app } from '../src/index'

const NEWSLETTER_ID = '11111111-1111-4111-8111-111111111111'
const MISSING_NEWSLETTER_ID = '22222222-2222-4222-8222-222222222222'
const SECOND_NEWSLETTER_ID = '33333333-3333-4333-8333-333333333333'
const SUBSCRIBER_EMAIL = 'user@example.com'
const TRACKED_PUBLISH_PAYLOAD = {
  subject: 'Tracked title',
  html: '<p>Hello tracked subscribers</p>',
  text: 'Hello tracked subscribers',
  sourceMessageId: 'tracked-source-message',
}

type NewsletterRecord = {
  id: string
  subscribable: number
}

type SubscriberRecord = {
  email: string
  newsletterId: string
  firstName: string | null
  lastName: string | null
  isSubscribed: number
}

type FakeDatabaseOptions = {
  denyBuckets?: string[]
  missingAbuseEventTable?: boolean
  failRecipientStatusUpdates?: string[]
}

type AbuseEvent = {
  bucket: string
  keyHash: string
  createdAt: string
}

type SuppressionEvent = {
  email: string
  newsletterId: string | null
  eventType: string
  providerMessageId: string | null
  providerPayload: string
  createdAt: string
}

type NewsletterSendRecord = {
  id: string
  newsletterId: string
  subject: string
  sourceMessageId: string | null
  status: string
  recipientCount: number
  queuedCount: number
  queueFailedCount: number
  providerAcceptedCount: number
  deliveredCount: number
  deliveryDelayedCount: number
  bouncedCount: number
  complainedCount: number
  failedCount: number
  deadLetteredCount: number
  lastError: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

type NewsletterSendRecipientRecord = {
  id: string
  sendId: string
  newsletterId: string
  email: string
  recipientHash: string
  status: string
  attempts: number
  failureType: string | null
  providerMessageId: string | null
  lastError: string | null
  queuedAt: string | null
  sendingAt: string | null
  providerAcceptedAt: string | null
  deliveryDelayedAt: string | null
  deliveredAt: string | null
  bouncedAt: string | null
  complainedAt: string | null
  failedAt: string | null
  deadLetteredAt: string | null
  updatedAt: string
}

type NewsletterSendEventRecord = {
  id: number
  sendId: string
  newsletterId: string
  recipientId: string | null
  recipientHash: string | null
  email: string | null
  eventType: string
  recipientStatus: string | null
  sendStatus: string | null
  message: string | null
  providerMessageId: string | null
  providerPayload: string | null
  createdAt: string
}

class FakeKVNamespace {
  readonly store = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }
}

class FakeD1PreparedStatement {
  private params: unknown[] = []

  constructor(
    private readonly db: FakeD1Database,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params
    return this
  }

  async first<T = unknown>(): Promise<T | null> {
    return this.db.first<T>(this.sql, this.params)
  }

  async all<T = unknown>(): Promise<{ results: T[] }> {
    return this.db.all<T>(this.sql, this.params)
  }

  async run(): Promise<{ meta: { changes: number } }> {
    return this.db.run(this.sql, this.params)
  }
}

class FakeD1Database {
  readonly newsletters = new Map<string, NewsletterRecord>()
  readonly subscribers = new Map<string, SubscriberRecord>()
  readonly abuseEvents: AbuseEvent[] = []
  readonly suppressionEvents: SuppressionEvent[] = []
  readonly newsletterSends = new Map<string, NewsletterSendRecord>()
  readonly newsletterSendRecipients = new Map<string, NewsletterSendRecipientRecord>()
  readonly newsletterSendEvents: NewsletterSendEventRecord[] = []
  readonly attemptedRateLimitBuckets: string[] = []

  private readonly denyBuckets: Set<string>
  private readonly missingAbuseEventTable: boolean
  private readonly failRecipientStatusUpdates: Set<string>
  private nextNewsletterSendEventId = 1

  constructor(options: FakeDatabaseOptions = {}) {
    this.denyBuckets = new Set(options.denyBuckets ?? [])
    this.missingAbuseEventTable = options.missingAbuseEventTable ?? false
    this.failRecipientStatusUpdates = new Set(options.failRecipientStatusUpdates ?? [])
  }

  prepare(sql: string): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(this, sql)
  }

  async batch(statements: Array<FakeD1PreparedStatement>) {
    return Promise.all(statements.map((statement) => statement.run()))
  }

  async first<T>(sql: string, params: unknown[]): Promise<T | null> {
    const normalized = normalizeSql(sql)
    if (normalized.includes('select id, subscribable from newsletter where id = ?')) {
      const newsletterId = String(params[0] ?? '')
      return (this.newsletters.get(newsletterId) ?? null) as T | null
    }

    if (normalized.includes('select id from newsletter where id = ?')) {
      const newsletterId = String(params[0] ?? '')
      const newsletter = this.newsletters.get(newsletterId)
      return (newsletter ? { id: newsletter.id } : null) as T | null
    }

    if (normalized.includes('from newslettersendrecipient') && normalized.includes('count(*) as recipientcount')) {
      const sendId = String(params[0] ?? '')
      const recipients = Array.from(this.newsletterSendRecipients.values())
        .filter((recipient) => recipient.sendId === sendId)
      const countStatus = (status: string) => recipients.filter((recipient) => recipient.status === status).length
      return ({
        recipientCount: recipients.length,
        queuedCount: countStatus('queued'),
        queueFailedCount: recipients.filter((recipient) => recipient.status === 'failed' && recipient.failureType === 'queue').length,
        providerAcceptedCount: countStatus('providerAccepted'),
        deliveredCount: countStatus('delivered'),
        deliveryDelayedCount: countStatus('deliveryDelayed'),
        bouncedCount: countStatus('bounced'),
        complainedCount: countStatus('complained'),
        failedCount: recipients.filter((recipient) => recipient.status === 'failed' && recipient.failureType !== 'queue').length,
        deadLetteredCount: countStatus('deadLettered'),
        activeCount: recipients.filter((recipient) =>
          ['queued', 'sending', 'providerAccepted', 'deliveryDelayed', 'retrying'].includes(recipient.status)
        ).length,
      } as T)
    }

    if (normalized.includes('from newslettersendrecipient') && normalized.includes('where send_id = ? and recipient_hash = ?')) {
      const sendId = String(params[0] ?? '')
      const recipientHash = String(params[1] ?? '')
      return (this.newsletterSendRecipients.get(`${sendId}:${recipientHash}`) ?? null) as T | null
    }

    if (normalized.includes('from newslettersendevent') && normalized.includes('where id = ?')) {
      const id = Number(params[0] ?? 0)
      return (this.newsletterSendEvents.find((event) => event.id === id) ?? null) as T | null
    }

    if (normalized.includes('from newslettersend') && normalized.includes('where id = ?')) {
      const sendId = String(params[0] ?? '')
      return (this.newsletterSends.get(sendId) ?? null) as T | null
    }

    return null
  }

  async all<T>(sql: string, params: unknown[]): Promise<{ results: T[] }> {
    const normalized = normalizeSql(sql)

    if (normalized.includes('select email from subscriber where newsletter_id = ? and issubscribed = 1')) {
      const newsletterId = String(params[0] ?? '')
      const subscribers = Array.from(this.subscribers.values())
        .filter((subscriber) => (
          subscriber.newsletterId === newsletterId &&
          subscriber.isSubscribed === 1
        ))
        .map((subscriber) => ({ email: subscriber.email }))
      return { results: subscribers as T[] }
    }

    if (normalized.includes('from newslettersendrecipient') && normalized.includes('where send_id = ?')) {
      const sendId = String(params[0] ?? '')
      const recipients = Array.from(this.newsletterSendRecipients.values())
        .filter((recipient) => recipient.sendId === sendId)
        .sort((a, b) => a.email.localeCompare(b.email))
      return { results: recipients as T[] }
    }

    if (normalized.includes('from newslettersendevent') && normalized.includes('where send_id = ? and id > ?')) {
      const sendId = String(params[0] ?? '')
      const afterId = Number(params[1] ?? 0)
      const limit = Number(params[2] ?? Number.MAX_SAFE_INTEGER)
      const events = this.newsletterSendEvents
        .filter((event) => event.sendId === sendId && event.id > afterId)
        .sort((a, b) => a.id - b.id)
        .slice(0, limit)
      return { results: events as T[] }
    }

    if (normalized.includes('from newslettersend') && normalized.includes('where newsletter_id = ?')) {
      const newsletterId = String(params[0] ?? '')
      const sends = Array.from(this.newsletterSends.values())
        .filter((send) => send.newsletterId === newsletterId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      return { results: sends as T[] }
    }

    return { results: [] }
  }

  async run(sql: string, params: unknown[]): Promise<{ meta: { changes: number } }> {
    const normalized = normalizeSql(sql)

    if (normalized.includes('insert into subscriber')) {
      const email = String(params[0] ?? '')
      const firstName = normalizeNameParam(params[1])
      const lastName = normalizeNameParam(params[2])
      const newsletterId = String(params[3] ?? '')
      const key = `${newsletterId}:${email}`
      const existing = this.subscribers.get(key)
      this.subscribers.set(key, {
        email,
        newsletterId,
        firstName: firstName ?? existing?.firstName ?? null,
        lastName: lastName ?? existing?.lastName ?? null,
        isSubscribed: 1,
      })
      return { meta: { changes: 1 } }
    }

    if (normalized.includes('update subscriber set issubscribed = 0')) {
      const email = String(params[0] ?? '')
      const newsletterId = String(params[1] ?? '')
      const key = `${newsletterId}:${email}`
      const existing = this.subscribers.get(key) ?? {
        email,
        newsletterId,
        firstName: null,
        lastName: null,
        isSubscribed: 0,
      }
      existing.isSubscribed = 0
      this.subscribers.set(key, existing)
      return { meta: { changes: 1 } }
    }

    if (normalized.includes('insert into abuseevent')) {
      if (this.missingAbuseEventTable) {
        throw new Error('D1_ERROR: no such table: AbuseEvent')
      }

      const bucket = String(params[1] ?? '')
      const keyHash = String(params[2] ?? '')
      const createdAt = String(params[3] ?? '')
      const sinceIso = String(params[6] ?? '')
      const maxRequests = Number(params[7] ?? 0)

      this.attemptedRateLimitBuckets.push(bucket)

      if (this.denyBuckets.has(bucket)) {
        return { meta: { changes: 0 } }
      }

      const countInWindow = this.abuseEvents.filter((event) => (
        event.bucket === bucket &&
        event.keyHash === keyHash &&
        event.createdAt >= sinceIso
      )).length

      if (countInWindow >= maxRequests) {
        return { meta: { changes: 0 } }
      }

      this.abuseEvents.push({ bucket, keyHash, createdAt })
      return { meta: { changes: 1 } }
    }

    if (normalized.includes('insert into suppressionevent')) {
      this.suppressionEvents.push({
        email: String(params[1] ?? ''),
        newsletterId: params[2] === null ? null : String(params[2] ?? ''),
        eventType: String(params[3] ?? ''),
        providerMessageId: params[4] === null ? null : String(params[4] ?? ''),
        providerPayload: String(params[5] ?? ''),
        createdAt: String(params[6] ?? ''),
      })
      return { meta: { changes: 1 } }
    }

    if (normalized.includes('insert into newslettersendrecipient')) {
      const recipient: NewsletterSendRecipientRecord = {
        id: String(params[0] ?? ''),
        sendId: String(params[1] ?? ''),
        newsletterId: String(params[2] ?? ''),
        email: String(params[3] ?? ''),
        recipientHash: String(params[4] ?? ''),
        status: String(params[5] ?? ''),
        attempts: 0,
        failureType: null,
        providerMessageId: null,
        lastError: null,
        queuedAt: String(params[6] ?? ''),
        sendingAt: null,
        providerAcceptedAt: null,
        deliveryDelayedAt: null,
        deliveredAt: null,
        bouncedAt: null,
        complainedAt: null,
        failedAt: null,
        deadLetteredAt: null,
        updatedAt: String(params[7] ?? ''),
      }
      this.newsletterSendRecipients.set(`${recipient.sendId}:${recipient.recipientHash}`, recipient)
      return { meta: { changes: 1 } }
    }

    if (normalized.includes('insert into newslettersendevent')) {
      const event: NewsletterSendEventRecord = {
        id: this.nextNewsletterSendEventId,
        sendId: String(params[0] ?? ''),
        newsletterId: String(params[1] ?? ''),
        recipientId: params[2] === null ? null : String(params[2] ?? ''),
        recipientHash: params[3] === null ? null : String(params[3] ?? ''),
        email: params[4] === null ? null : String(params[4] ?? ''),
        eventType: String(params[5] ?? ''),
        recipientStatus: params[6] === null ? null : String(params[6] ?? ''),
        sendStatus: params[7] === null ? null : String(params[7] ?? ''),
        message: params[8] === null ? null : String(params[8] ?? ''),
        providerMessageId: params[9] === null ? null : String(params[9] ?? ''),
        providerPayload: params[10] === null ? null : String(params[10] ?? ''),
        createdAt: String(params[11] ?? ''),
      }
      this.nextNewsletterSendEventId += 1
      this.newsletterSendEvents.push(event)
      return { meta: { changes: 1, last_row_id: event.id } as { changes: number; last_row_id: number } }
    }

    if (normalized.includes('insert into newslettersend')) {
      const send: NewsletterSendRecord = {
        id: String(params[0] ?? ''),
        newsletterId: String(params[1] ?? ''),
        subject: String(params[2] ?? ''),
        sourceMessageId: params[3] === null ? null : String(params[3] ?? ''),
        status: String(params[4] ?? ''),
        recipientCount: Number(params[5] ?? 0),
        queuedCount: 0,
        queueFailedCount: 0,
        providerAcceptedCount: 0,
        deliveredCount: 0,
        deliveryDelayedCount: 0,
        bouncedCount: 0,
        complainedCount: 0,
        failedCount: 0,
        deadLetteredCount: 0,
        lastError: null,
        createdAt: String(params[6] ?? ''),
        updatedAt: String(params[7] ?? ''),
        completedAt: null,
      }
      this.newsletterSends.set(send.id, send)
      return { meta: { changes: 1 } }
    }

    if (normalized.includes('update newslettersendrecipient')) {
      let index = 0
      const status = String(params[index++] ?? '')
      if (this.failRecipientStatusUpdates.has(status)) {
        throw new Error(`Simulated status update failure: ${status}`)
      }
      const attempts = Number(params[index++] ?? 0)
      const providerMessageId = params[index] === null ? null : String(params[index] ?? '')
      index += 1
      const lastError = params[index] === null ? null : String(params[index] ?? '')
      index += 1
      const failureType = params[index] === null ? null : String(params[index] ?? '')
      index += 1
      let timestamp: string | null = null
      const timestampColumns = [
        'queuedat = ?',
        'sendingat = ?',
        'provideracceptedat = ?',
        'deliverydelayedat = ?',
        'deliveredat = ?',
        'bouncedat = ?',
        'complainedat = ?',
        'failedat = ?',
        'deadletteredat = ?',
      ]
      if (timestampColumns.some((column) => normalized.includes(column))) {
        timestamp = String(params[index++] ?? '')
      }
      const updatedAt = String(params[index++] ?? '')
      const sendId = String(params[index++] ?? '')
      const recipientHash = String(params[index++] ?? '')
      const recipient = this.newsletterSendRecipients.get(`${sendId}:${recipientHash}`)
      if (recipient) {
        recipient.status = status
        recipient.attempts = attempts
        recipient.providerMessageId = providerMessageId
        recipient.lastError = lastError
        recipient.failureType = failureType
        recipient.updatedAt = updatedAt
        if (timestamp) {
          if (normalized.includes('queuedat = ?')) recipient.queuedAt = timestamp
          if (normalized.includes('sendingat = ?')) recipient.sendingAt = timestamp
          if (normalized.includes('provideracceptedat = ?')) recipient.providerAcceptedAt = timestamp
          if (normalized.includes('deliverydelayedat = ?')) recipient.deliveryDelayedAt = timestamp
          if (normalized.includes('deliveredat = ?')) recipient.deliveredAt = timestamp
          if (normalized.includes('bouncedat = ?')) recipient.bouncedAt = timestamp
          if (normalized.includes('complainedat = ?')) recipient.complainedAt = timestamp
          if (normalized.includes('failedat = ?')) recipient.failedAt = timestamp
          if (normalized.includes('deadletteredat = ?')) recipient.deadLetteredAt = timestamp
        }
      }
      return { meta: { changes: recipient ? 1 : 0 } }
    }

    if (normalized.includes('update newslettersend')) {
      const sendId = String(params[14] ?? '')
      const send = this.newsletterSends.get(sendId)
      if (send) {
        send.status = String(params[0] ?? '')
        send.recipientCount = Number(params[1] ?? 0)
        send.queuedCount = Number(params[2] ?? 0)
        send.queueFailedCount = Number(params[3] ?? 0)
        send.providerAcceptedCount = Number(params[4] ?? 0)
        send.deliveredCount = Number(params[5] ?? 0)
        send.deliveryDelayedCount = Number(params[6] ?? 0)
        send.bouncedCount = Number(params[7] ?? 0)
        send.complainedCount = Number(params[8] ?? 0)
        send.failedCount = Number(params[9] ?? 0)
        send.deadLetteredCount = Number(params[10] ?? 0)
        if (params[11] !== null) {
          send.lastError = String(params[11] ?? '')
        }
        send.updatedAt = String(params[12] ?? '')
        send.completedAt = params[13] === null ? null : String(params[13] ?? '')
      }
      return { meta: { changes: send ? 1 : 0 } }
    }

    if (normalized.includes('delete from abuseevent where createdat < ?')) {
      if (this.missingAbuseEventTable) {
        throw new Error('D1_ERROR: no such table: AbuseEvent')
      }

      const cutoff = String(params[0] ?? '')
      const remaining = this.abuseEvents.filter((event) => event.createdAt >= cutoff)
      this.abuseEvents.length = 0
      this.abuseEvents.push(...remaining)
      return { meta: { changes: 1 } }
    }

    throw new Error(`Unsupported SQL in test DB: ${sql}`)
  }
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase()
}

function normalizeNameParam(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function createEnv(options: FakeDatabaseOptions = {}) {
  const db = new FakeD1Database(options)
  db.newsletters.set(NEWSLETTER_ID, { id: NEWSLETTER_ID, subscribable: 1 })

  const kv = new FakeKVNamespace()
  const notificationFetch = vi.fn(async () => (
    new Response(JSON.stringify({ message: 'success', messageId: 'ses-message-id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ))
  const r2Objects = new Map<string, string>()
  const r2Put = vi.fn(async (key: string, value: string) => {
    r2Objects.set(key, value)
  })
  const r2Get = vi.fn(async (key: string) => {
    const value = r2Objects.get(key)
    if (value === undefined) {
      return null
    }
    return {
      text: async () => value,
    }
  })
  const queueSend = vi.fn()
  const sendStatusBrokerFetch = vi.fn(async () => (
    new Response(JSON.stringify({ message: 'Broadcast sent' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ))
  const sendStatusBrokerGetByName = vi.fn(() => ({
    fetch: sendStatusBrokerFetch,
  }))

  const env = {
    DB: db as unknown as D1Database,
    NOTIFICATION: { fetch: notificationFetch } as unknown as Fetcher,
    KV: kv as unknown as KVNamespace,
    R2: {
      put: r2Put,
      get: r2Get,
      list: vi.fn(async () => ({ objects: [], truncated: false })),
      delete: vi.fn(),
    } as unknown as R2Bucket,
    QUEUE: { send: queueSend } as unknown as Queue,
    SEND_STATUS_BROKER: {
      getByName: sendStatusBrokerGetByName,
    } as unknown as DurableObjectNamespace,
    ALLOWED_EMAILS: 'sender@example.com',
    PUBLISH_EMAIL_ADDRESS: 'publish@example.com',
    NOTIFICATION_SHARED_SECRET: 'notification-secret',
    PUBLIC_ORIGIN: 'https://newsletter.example.com',
    PUBLISH_BRIDGE_TOKEN: 'bridge-token',
    ADMIN_API_TOKEN: 'admin-token',
    TURNSTILE_SECRET_KEY: 'turnstile-secret',
    TURNSTILE_SITE_KEY: 'turnstile-site-key',
    UNSUBSCRIBE_SIGNING_SECRET: 'unsubscribe-secret',
    SES_SNS_WEBHOOK_TOKEN: 'ses-webhook-token',
    SES_SNS_TOPIC_ARN: 'arn:aws:sns:us-west-1:123456789012:letterdrop',
  }

  return {
    env,
    db,
    kv,
    notificationFetch,
    r2Put,
    r2Get,
    queueSend,
    sendStatusBrokerFetch,
    sendStatusBrokerGetByName,
  }
}

async function postJson(
  env: Record<string, unknown>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return app.request(`https://example.com${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  }, env)
}

async function postRawJson(
  env: Record<string, unknown>,
  path: string,
  body: string,
  headers: Record<string, string> = {}
) {
  return app.request(`https://example.com${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body,
  }, env)
}

function createRawEmailStream(subject: string, messageId: string) {
  const rawEmail = [
    'From: sender@example.com',
    'To: publish@example.com',
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="letterdrop-test"',
    '',
    '--letterdrop-test',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    'Hello subscribers',
    '--letterdrop-test',
    'Content-Type: text/html; charset=UTF-8',
    '',
    '<h1>Hello subscribers</h1>',
    '--letterdrop-test--',
    '',
  ].join('\r\n')
  const rawBytes = new TextEncoder().encode(rawEmail)

  return {
    rawSize: rawBytes.byteLength,
    raw: new ReadableStream({
      start(controller) {
        controller.enqueue(rawBytes)
        controller.close()
      },
    }),
  }
}

function createTextOnlyRawEmailStream(subject: string, messageId: string) {
  const rawEmail = [
    'From: sender@example.com',
    'To: publish@example.com',
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    'Hello subscribers',
    '',
  ].join('\r\n')
  const rawBytes = new TextEncoder().encode(rawEmail)

  return {
    rawSize: rawBytes.byteLength,
    raw: new ReadableStream({
      start(controller) {
        controller.enqueue(rawBytes)
        controller.close()
      },
    }),
  }
}

function createQueueBatch(body: Record<string, unknown>, queue = 'letterdrop-test') {
  const message = {
    id: 'queue-message-id',
    timestamp: new Date(),
    body,
    attempts: 1,
    retry: vi.fn(),
    ack: vi.fn(),
  }

  return {
    batch: {
      messages: [message],
      queue,
      metadata: { metrics: { backlogCount: 1, backlogBytes: 1 } },
      retryAll: vi.fn(),
      ackAll: vi.fn(),
    } as unknown as MessageBatch<Record<string, unknown>>,
    message,
  }
}

async function getNotificationRequestBody(notificationFetch: ReturnType<typeof vi.fn>) {
  const request = notificationFetch.mock.calls.at(-1)?.[0] as Request
  return request.json() as Promise<Record<string, unknown>>
}

function extractUnsubscribeToken(sendBody: Record<string, unknown>): string {
  const headers = sendBody.headers as Array<{ name: string; value: string }>
  const header = headers.find((entry) => entry.name === 'List-Unsubscribe')
  const match = header?.value.match(/list-unsubscribe\/([^>]+)>$/)
  if (!match) {
    throw new Error('List-Unsubscribe header missing token')
  }
  return match[1]
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function pemFromDer(label: string, der: Uint8Array): string {
  const base64 = bytesToBase64(der)
  const lines = base64.match(/.{1,64}/g) ?? []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`
}

function buildTestSnsStringToSign(envelope: Record<string, unknown>): string {
  const type = envelope.Type
  const fields = type === 'Notification'
    ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
    : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']
  return fields
    .filter((field) => field !== 'Subject' || typeof envelope.Subject === 'string')
    .map((field) => `${field}\n${String(envelope[field])}`)
    .join('\n')
}

async function createSnsSigner() {
  const certUrl = 'https://sns.us-west-1.amazonaws.com/SimpleNotificationService-test.pem'
  const subscribeUrl = [
    'https://sns.us-west-1.amazonaws.com/',
    '?Action=ConfirmSubscription',
    `&TopicArn=${encodeURIComponent('arn:aws:sns:us-west-1:123456789012:letterdrop')}`,
    '&Token=confirmation-token',
  ].join('')
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  ) as CryptoKeyPair
  const publicKeyDer = new Uint8Array(
    await crypto.subtle.exportKey('spki', keyPair.publicKey)
  )
  const publicKeyPem = pemFromDer('PUBLIC KEY', publicKeyDer)
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url === certUrl) {
      return new Response(publicKeyPem)
    }
    if (url === subscribeUrl) {
      return new Response('<ConfirmSubscriptionResponse />', { status: 200 })
    }
    return new Response('not found', { status: 404 })
  })

  async function signEnvelope(base: Record<string, unknown>) {
    const envelope = {
      MessageId: 'sns-message-id',
      Timestamp: '2026-04-28T18:30:00.000Z',
      SignatureVersion: '2',
      SigningCertURL: certUrl,
      ...base,
    }
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      keyPair.privateKey,
      new TextEncoder().encode(buildTestSnsStringToSign(envelope))
    )
    return {
      ...envelope,
      Signature: bytesToBase64(new Uint8Array(signature)),
    }
  }

  return { fetchSpy, signEnvelope, subscribeUrl }
}

describe('admin auth middleware', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects unauthenticated /api/newsletter routes', async () => {
    const { env } = createEnv()
    const protectedPaths = [
      '/api/newsletter',
      `/api/newsletter/${NEWSLETTER_ID}`,
      '/api/newsletter/publish-config',
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers`,
      `/api/newsletter/${NEWSLETTER_ID}/offline`,
    ]

    for (const path of protectedPaths) {
      const response = await app.request(`https://example.com${path}`, {}, env)
      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    }
  })

  it('rejects incorrect bearer tokens', async () => {
    const { env } = createEnv()
    const response = await app.request('https://example.com/api/newsletter', {
      headers: { Authorization: 'Bearer wrong-token' },
    }, env)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('fails closed when ADMIN_API_TOKEN is not configured', async () => {
    const { env } = createEnv()
    env.ADMIN_API_TOKEN = ''

    const response = await app.request('https://example.com/api/newsletter', {}, env)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Admin API unavailable' })
  })
})

describe('publish config', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the normalized publish email address for authenticated admin requests', async () => {
    const { env } = createEnv()
    env.PUBLISH_EMAIL_ADDRESS = ' Publish@Example.com '

    const response = await app.request('https://example.com/api/newsletter/publish-config', {
      headers: { Authorization: 'Bearer admin-token' },
    }, env)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ emailAddress: 'publish@example.com' })
  })

  it('returns 503 when the publish email address is missing or invalid', async () => {
    const { env } = createEnv()
    env.PUBLISH_EMAIL_ADDRESS = 'not-an-email'

    const response = await app.request('https://example.com/api/newsletter/publish-config', {
      headers: { Authorization: 'Bearer admin-token' },
    }, env)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Publish email address unavailable',
    })
  })
})

describe('direct newsletter publish endpoint', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  const publishPayload = {
    subject: 'Direct title: spaces & symbols',
    html: '<h1>Hello direct subscribers</h1>',
    text: 'Hello direct subscribers',
    sourceMessageId: 'direct-message-id',
  }

  it('rejects unauthenticated direct publish requests', async () => {
    const { env } = createEnv()

    const response = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      publishPayload
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('rejects invalid newsletter IDs', async () => {
    const { env, queueSend } = createEnv()

    const response = await postJson(
      env,
      '/api/newsletter/not-a-uuid/publish',
      TRACKED_PUBLISH_PAYLOAD,
      { Authorization: 'Bearer admin-token' }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid newsletterId' })
    expect(queueSend).not.toHaveBeenCalled()
  })

  it('rejects missing newsletters', async () => {
    const { env, queueSend } = createEnv()

    const response = await postJson(
      env,
      `/api/newsletter/${MISSING_NEWSLETTER_ID}/publish`,
      TRACKED_PUBLISH_PAYLOAD,
      { Authorization: 'Bearer admin-token' }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Newsletter not found' })
    expect(queueSend).not.toHaveBeenCalled()
  })

  it('rejects JSON bodies that are not objects', async () => {
    const { env, queueSend } = createEnv()

    const response = await postRawJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      'null',
      { Authorization: 'Bearer admin-token' }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON payload' })
    expect(queueSend).not.toHaveBeenCalled()
  })

  it('rejects oversized bodies even without a content-length header', async () => {
    const { env, queueSend } = createEnv()
    const body = JSON.stringify({
      ...publishPayload,
      html: 'x'.repeat(5 * 1024 * 1024),
    })

    const response = await postRawJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      body,
      { Authorization: 'Bearer admin-token' }
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'Request body too large' })
    expect(queueSend).not.toHaveBeenCalled()
  })

  it('stores newsletter HTML and queues subscribed recipients', async () => {
    const { env, db, r2Put, queueSend } = createEnv()
    env.ALLOWED_EMAILS = 'someone-else@example.com'
    db.subscribers.set(`${NEWSLETTER_ID}:first@example.com`, {
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })
    db.subscribers.set(`${NEWSLETTER_ID}:unsubscribed@example.com`, {
      email: 'unsubscribed@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 0,
    })

    const response = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      publishPayload,
      { Authorization: 'Bearer admin-token' }
    )
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result).toEqual(expect.objectContaining({
      newsletterId: NEWSLETTER_ID,
      subject: 'Direct title: spaces & symbols',
      sendId: expect.any(String),
      queueFailedCount: 0,
      queuedCount: 1,
      duplicate: false,
      fileName: expect.stringMatching(
        new RegExp(`^newsletters/${NEWSLETTER_ID}/\\d+\\.html$`)
      ),
      textFileName: expect.stringMatching(
        new RegExp(`^newsletters/${NEWSLETTER_ID}/\\d+\\.txt$`)
      ),
    }))
    expect(r2Put).toHaveBeenCalledWith(result.fileName, publishPayload.html)
    expect(r2Put).toHaveBeenCalledWith(result.textFileName, publishPayload.text)
    expect(queueSend).toHaveBeenCalledTimes(1)
    expect(queueSend).toHaveBeenCalledWith(expect.objectContaining({
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      subject: 'Direct title: spaces & symbols',
      fileName: result.fileName,
      textFileName: result.textFileName,
      sendId: result.sendId,
      recipientHash: expect.any(String),
    }))
    expect(db.newsletterSends.get(result.sendId)?.queuedCount).toBe(1)
    expect(db.newsletterSendRecipients.size).toBe(1)
  })

  it('does not requeue a direct publish source message that was already processed', async () => {
    const { env, db, r2Put, queueSend } = createEnv()
    db.subscribers.set(`${NEWSLETTER_ID}:first@example.com`, {
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })

    const firstResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      publishPayload,
      { Authorization: 'Bearer admin-token' }
    )
    const secondResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      publishPayload,
      { Authorization: 'Bearer admin-token' }
    )

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    await expect(secondResponse.json()).resolves.toEqual(expect.objectContaining({
      newsletterId: NEWSLETTER_ID,
      subject: 'Direct title: spaces & symbols',
      queuedCount: 0,
      queueFailedCount: 0,
      duplicate: true,
    }))
    expect(r2Put).toHaveBeenCalledTimes(2)
    expect(queueSend).toHaveBeenCalledTimes(1)
  })

  it('returns send history and recipient snapshots for tracked publishes', async () => {
    const { env, db } = createEnv()
    db.subscribers.set(`${NEWSLETTER_ID}:first@example.com`, {
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })
    const publishResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      publishPayload,
      { Authorization: 'Bearer admin-token' }
    )
    const publishResult = await publishResponse.json() as Record<string, unknown>

    const sendsResponse = await app.request(
      `https://example.com/api/newsletter/${NEWSLETTER_ID}/sends`,
      { headers: { Authorization: 'Bearer admin-token' } },
      env
    )
    const snapshotResponse = await app.request(
      `https://example.com/api/newsletter/${NEWSLETTER_ID}/sends/${publishResult.sendId}`,
      { headers: { Authorization: 'Bearer admin-token' } },
      env
    )
    const sendsResult = await sendsResponse.json() as { sends: Array<Record<string, unknown>> }
    const snapshot = await snapshotResponse.json() as {
      send: Record<string, unknown>
      recipients: Array<Record<string, unknown>>
      events: Array<Record<string, unknown>>
    }

    expect(sendsResponse.status).toBe(200)
    expect(snapshotResponse.status).toBe(200)
    expect(sendsResult.sends[0]).toEqual(expect.objectContaining({
      id: publishResult.sendId,
      newsletterId: NEWSLETTER_ID,
    }))
    expect(snapshot.send.id).toBe(publishResult.sendId)
    expect(snapshot.recipients).toHaveLength(1)
    expect(snapshot.events.map((event) => event.eventType)).toEqual([
      'sendCreated',
      'recipientQueued',
    ])
  })

  it('returns complete send event history beyond one D1 page', async () => {
    const { env, db } = createEnv()
    db.subscribers.set(`${NEWSLETTER_ID}:first@example.com`, {
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })
    const publishResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      publishPayload,
      { Authorization: 'Bearer admin-token' }
    )
    const publishResult = await publishResponse.json() as Record<string, unknown>
    db.newsletterSendEvents.length = 0
    for (let id = 1; id <= 505; id += 1) {
      db.newsletterSendEvents.push({
        id,
        sendId: String(publishResult.sendId),
        newsletterId: NEWSLETTER_ID,
        recipientId: null,
        recipientHash: null,
        email: null,
        eventType: `event-${id}`,
        recipientStatus: null,
        sendStatus: 'sending',
        message: null,
        providerMessageId: null,
        providerPayload: null,
        createdAt: '2026-04-28T19:00:00.000Z',
      })
    }

    const snapshotResponse = await app.request(
      `https://example.com/api/newsletter/${NEWSLETTER_ID}/sends/${publishResult.sendId}`,
      { headers: { Authorization: 'Bearer admin-token' } },
      env
    )
    const snapshot = await snapshotResponse.json() as {
      events: Array<Record<string, unknown>>
      lastEventId: number
    }

    expect(snapshotResponse.status).toBe(200)
    expect(snapshot.events).toHaveLength(505)
    expect(snapshot.lastEventId).toBe(505)
  })

  it('scopes duplicate source messages by newsletter', async () => {
    const { env, db, r2Put, queueSend } = createEnv()
    db.newsletters.set(SECOND_NEWSLETTER_ID, {
      id: SECOND_NEWSLETTER_ID,
      subscribable: 1,
    })
    db.subscribers.set(`${NEWSLETTER_ID}:first@example.com`, {
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })
    db.subscribers.set(`${SECOND_NEWSLETTER_ID}:second@example.com`, {
      email: 'second@example.com',
      newsletterId: SECOND_NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })
    const sharedSourcePayload = {
      ...publishPayload,
      sourceMessageId: 'shared-source-id',
    }

    const firstResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      sharedSourcePayload,
      { Authorization: 'Bearer admin-token' }
    )
    const secondResponse = await postJson(
      env,
      `/api/newsletter/${SECOND_NEWSLETTER_ID}/publish`,
      sharedSourcePayload,
      { Authorization: 'Bearer admin-token' }
    )
    const secondResult = await secondResponse.json()

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect(secondResult).toEqual(expect.objectContaining({
      newsletterId: SECOND_NEWSLETTER_ID,
      queuedCount: 1,
      duplicate: false,
    }))
    expect(r2Put).toHaveBeenCalledTimes(4)
    expect(queueSend).toHaveBeenCalledTimes(2)
    expect(queueSend).toHaveBeenLastCalledWith(expect.objectContaining({
      email: 'second@example.com',
      newsletterId: SECOND_NEWSLETTER_ID,
      subject: 'Direct title: spaces & symbols',
      fileName: secondResult.fileName,
      textFileName: secondResult.textFileName,
      sendId: secondResult.sendId,
      recipientHash: expect.any(String),
    }))
  })

  it('rejects missing subject, html, or text fields', async () => {
    const { env, queueSend } = createEnv()
    const cases = [
      {
        body: { ...publishPayload, subject: '   ' },
        error: 'Subject is required',
      },
      {
        body: { ...publishPayload, html: '' },
        error: 'Email html and text are required',
      },
      {
        body: { ...publishPayload, text: '' },
        error: 'Email html and text are required',
      },
    ]

    for (const testCase of cases) {
      const response = await postJson(
        env,
        `/api/newsletter/${NEWSLETTER_ID}/publish`,
        testCase.body,
        { Authorization: 'Bearer admin-token' }
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: testCase.error })
    }
    expect(queueSend).not.toHaveBeenCalled()
  })
})

describe('Google Workspace publish bridge', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  const publishPayload = {
    from: 'Haben Girma <sender@example.com>',
    subject: `[Newsletter-ID:${NEWSLETTER_ID}] Bridge title: spaces & symbols`,
    html: '<h1>Hello subscribers</h1>',
    text: 'Hello subscribers',
    messageId: 'gmail-message-id',
  }

  it('rejects unauthenticated bridge requests', async () => {
    const { env } = createEnv()

    const response = await postJson(
      env,
      '/api/publish/google-workspace',
      publishPayload
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('fails closed when the bridge token is not configured', async () => {
    const { env } = createEnv()
    env.PUBLISH_BRIDGE_TOKEN = ''

    const response = await postJson(
      env,
      '/api/publish/google-workspace',
      publishPayload,
      { Authorization: 'Bearer bridge-token' }
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Publish bridge unavailable',
    })
  })

  it('rejects JSON bridge bodies that are not objects', async () => {
    const { env, queueSend } = createEnv()

    const response = await postRawJson(
      env,
      '/api/publish/google-workspace',
      'null',
      { Authorization: 'Bearer bridge-token' }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON payload' })
    expect(queueSend).not.toHaveBeenCalled()
  })

  it('rejects senders outside the publish allowlist', async () => {
    const { env } = createEnv()

    const response = await postJson(
      env,
      '/api/publish/google-workspace',
      {
        ...publishPayload,
        from: 'intruder@example.com',
      },
      { Authorization: 'Bearer bridge-token' }
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Sender not allowed',
    })
  })

  it('stores the newsletter HTML and queues subscribers', async () => {
    const { env, db, r2Put, queueSend } = createEnv()
    db.subscribers.set(`${NEWSLETTER_ID}:first@example.com`, {
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })
    db.subscribers.set(`${NEWSLETTER_ID}:unsubscribed@example.com`, {
      email: 'unsubscribed@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 0,
    })

    const response = await postJson(
      env,
      '/api/publish/google-workspace',
      publishPayload,
      { Authorization: 'Bearer bridge-token' }
    )
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result).toEqual(expect.objectContaining({
      newsletterId: NEWSLETTER_ID,
      subject: 'Bridge title: spaces & symbols',
      sendId: expect.any(String),
      queueFailedCount: 0,
      queuedCount: 1,
      duplicate: false,
      fileName: expect.stringMatching(
        new RegExp(`^newsletters/${NEWSLETTER_ID}/\\d+\\.html$`)
      ),
      textFileName: expect.stringMatching(
        new RegExp(`^newsletters/${NEWSLETTER_ID}/\\d+\\.txt$`)
      ),
    }))
    expect(r2Put).toHaveBeenCalledWith(result.fileName, publishPayload.html)
    expect(r2Put).toHaveBeenCalledWith(result.textFileName, publishPayload.text)
    expect(queueSend).toHaveBeenCalledTimes(1)
    expect(queueSend).toHaveBeenCalledWith(expect.objectContaining({
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      subject: 'Bridge title: spaces & symbols',
      fileName: result.fileName,
      textFileName: result.textFileName,
      sendId: result.sendId,
      recipientHash: expect.any(String),
    }))
  })

  it('does not requeue a Gmail message that was already processed', async () => {
    const { env, db, queueSend } = createEnv()
    db.subscribers.set(`${NEWSLETTER_ID}:first@example.com`, {
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })

    const firstResponse = await postJson(
      env,
      '/api/publish/google-workspace',
      publishPayload,
      { Authorization: 'Bearer bridge-token' }
    )
    const secondResponse = await postJson(
      env,
      '/api/publish/google-workspace',
      publishPayload,
      { Authorization: 'Bearer bridge-token' }
    )

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    await expect(secondResponse.json()).resolves.toEqual(expect.objectContaining({
      newsletterId: NEWSLETTER_ID,
      subject: 'Bridge title: spaces & symbols',
      queuedCount: 0,
      queueFailedCount: 0,
      duplicate: true,
    }))
    expect(queueSend).toHaveBeenCalledTimes(1)
  })

  it('rejects messages without a newsletter ID in the subject', async () => {
    const { env, queueSend } = createEnv()

    const response = await postJson(
      env,
      '/api/publish/google-workspace',
      {
        ...publishPayload,
        subject: 'Bridge title without an ID',
      },
      { Authorization: 'Bearer bridge-token' }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'No Newsletter ID found in subject',
    })
    expect(queueSend).not.toHaveBeenCalled()
  })

  it('rejects bridge messages with blank HTML or text bodies', async () => {
    const { env, queueSend } = createEnv()
    const cases = [
      { ...publishPayload, html: '   ' },
      { ...publishPayload, text: '' },
    ]

    for (const body of cases) {
      const response = await postJson(
        env,
        '/api/publish/google-workspace',
        body,
        { Authorization: 'Bearer bridge-token' }
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'Email html and text are required',
      })
    }
    expect(queueSend).not.toHaveBeenCalled()
  })
})

describe('Cloudflare Email Worker publish path', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('stores email worker HTML and queues subscribers through the shared publisher', async () => {
    const { env, db, r2Put, queueSend } = createEnv()
    db.subscribers.set(`${NEWSLETTER_ID}:first@example.com`, {
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })
    const subject = `[Newsletter-ID:${NEWSLETTER_ID}] Email worker title`
    const rawEmail = createRawEmailStream(subject, '<cloudflare-message-id@example.com>')
    const setReject = vi.fn()

    await worker.email({
      from: 'sender@example.com',
      to: 'publish@example.com',
      headers: new Headers({
        subject,
        'message-id': '<cloudflare-message-id@example.com>',
      }),
      raw: rawEmail.raw,
      rawSize: rawEmail.rawSize,
      setReject,
    } as unknown as ForwardableEmailMessage, env, {} as ExecutionContext)

    expect(setReject).not.toHaveBeenCalled()
    const fileName = r2Put.mock.calls[0][0]
    const html = r2Put.mock.calls[0][1]
    expect(fileName).toEqual(
      expect.stringMatching(new RegExp(`^newsletters/${NEWSLETTER_ID}/\\d+\\.html$`))
    )
    expect(String(html).trim()).toBe('<h1>Hello subscribers</h1>')
    const textFileName = r2Put.mock.calls[1][0]
    const text = r2Put.mock.calls[1][1]
    expect(textFileName).toEqual(
      expect.stringMatching(new RegExp(`^newsletters/${NEWSLETTER_ID}/\\d+\\.txt$`))
    )
    expect(String(text).trim()).toBe('Hello subscribers')
    expect(queueSend).toHaveBeenCalledWith(expect.objectContaining({
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      subject: 'Email worker title',
      fileName,
      textFileName,
      sendId: expect.any(String),
      recipientHash: expect.any(String),
    }))
  })

  it('logs and returns when inbound email parsing does not produce HTML and text', async () => {
    const { env, r2Put, queueSend } = createEnv()
    const subject = `[Newsletter-ID:${NEWSLETTER_ID}] Text-only email`
    const rawEmail = createTextOnlyRawEmailStream(
      subject,
      '<text-only-message-id@example.com>'
    )
    const setReject = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await worker.email({
      from: 'sender@example.com',
      to: 'publish@example.com',
      headers: new Headers({
        subject,
        'message-id': '<text-only-message-id@example.com>',
      }),
      raw: rawEmail.raw,
      rawSize: rawEmail.rawSize,
      setReject,
    } as unknown as ForwardableEmailMessage, env, {} as ExecutionContext)

    expect(consoleError).toHaveBeenCalledWith('Can not parse email')
    expect(setReject).not.toHaveBeenCalled()
    expect(r2Put).not.toHaveBeenCalled()
    expect(queueSend).not.toHaveBeenCalled()
  })
})

describe('newsletter queue delivery', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  async function publishTrackedNewsletter() {
    const { env, db, notificationFetch, queueSend, sendStatusBrokerFetch } = createEnv()
    db.subscribers.set(`${NEWSLETTER_ID}:first@example.com`, {
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })
    const response = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      TRACKED_PUBLISH_PAYLOAD,
      { Authorization: 'Bearer admin-token' }
    )
    const result = await response.json() as Record<string, unknown>
    expect(response.status).toBe(200)
    return {
      env,
      db,
      notificationFetch,
      sendStatusBrokerFetch,
      queueBody: queueSend.mock.calls[0][0] as Record<string, unknown>,
      sendId: String(result.sendId),
    }
  }

  it('sends newsletter mail with text content, unsubscribe headers, footer, and SES tags', async () => {
    const { env, notificationFetch } = createEnv()
    const fileName = `newsletters/${NEWSLETTER_ID}/1.html`
    const textFileName = `newsletters/${NEWSLETTER_ID}/1.txt`
    await env.R2.put(fileName, '<html><body><h1>Hello</h1></body></html>')
    await env.R2.put(textFileName, 'Plain text body')
    const { batch, message } = createQueueBatch({
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      subject: 'Deliverability test',
      fileName,
      textFileName,
    })

    await worker.queue(batch, env)

    expect(message.retry).not.toHaveBeenCalled()
    expect(notificationFetch).toHaveBeenCalledTimes(1)
    const request = notificationFetch.mock.calls[0][0] as Request
    expect(request.headers.get('X-LetterDrop-Notification-Token')).toBe('notification-secret')
    const body = await getNotificationRequestBody(notificationFetch)
    expect(body.mail_to).toBe('first@example.com')
    expect(body.subject).toBe('Deliverability test')
    expect(String(body.txt)).toContain('Plain text body')
    expect(String(body.txt)).toContain('Unsubscribe: https://newsletter.example.com/api/subscribe/unsubscribe/')
    expect(String(body.html)).toContain('https://newsletter.example.com/api/subscribe/unsubscribe/')
    expect(body.headers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'List-Unsubscribe-Post',
        value: 'List-Unsubscribe=One-Click',
      }),
      expect.objectContaining({ name: 'X-Newsletter-ID', value: NEWSLETTER_ID }),
      expect.objectContaining({ name: 'X-Recipient-Hash' }),
    ]))
    expect(body.tags).toEqual(expect.arrayContaining([
      { name: 'newsletterId', value: NEWSLETTER_ID },
      expect.objectContaining({ name: 'recipientHash' }),
    ]))
  })

  it('keeps old queued messages deliverable when no text object is present', async () => {
    const { env, notificationFetch } = createEnv()
    const fileName = `newsletters/${NEWSLETTER_ID}/legacy.html`
    await env.R2.put(fileName, '<h1>Legacy</h1>')
    const { batch, message } = createQueueBatch({
      email: 'legacy@example.com',
      newsletterId: NEWSLETTER_ID,
      subject: 'Legacy message',
      fileName,
    })

    await worker.queue(batch, env)

    expect(message.retry).not.toHaveBeenCalled()
    const body = await getNotificationRequestBody(notificationFetch)
    expect(String(body.txt)).toContain('Unsubscribe: https://newsletter.example.com/api/subscribe/unsubscribe/')
    expect(String(body.html)).toContain('<h1>Legacy</h1>')
  })

  it('updates tracked recipients when SES accepts queued mail', async () => {
    const { env, db, notificationFetch, sendStatusBrokerFetch, queueBody, sendId } = await publishTrackedNewsletter()
    const { batch, message } = createQueueBatch(queueBody)

    await worker.queue(batch, env)

    expect(message.retry).not.toHaveBeenCalled()
    const body = await getNotificationRequestBody(notificationFetch)
    expect(body.headers).toEqual(expect.arrayContaining([
      { name: 'X-LetterDrop-Send-ID', value: sendId },
    ]))
    expect(body.tags).toEqual(expect.arrayContaining([
      { name: 'sendId', value: sendId },
    ]))
    const recipient = Array.from(db.newsletterSendRecipients.values())[0]
    expect(recipient).toEqual(expect.objectContaining({
      status: 'providerAccepted',
      attempts: 1,
      providerMessageId: 'ses-message-id',
    }))
    expect(db.newsletterSends.get(sendId)).toEqual(expect.objectContaining({
      status: 'sending',
      providerAcceptedCount: 1,
    }))
    expect(sendStatusBrokerFetch).toHaveBeenCalled()
    const broadcastPaths = sendStatusBrokerFetch.mock.calls.map((call) =>
      new URL((call[0] as Request).url).pathname
    )
    expect(broadcastPaths.every((path) => path === '/broadcast')).toBe(true)
  })

  it('does not retry after SES accepts when provider-accepted tracking fails', async () => {
    const { env, db, notificationFetch, queueSend } = createEnv({
      failRecipientStatusUpdates: ['providerAccepted'],
    })
    db.subscribers.set(`${NEWSLETTER_ID}:first@example.com`, {
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })
    const response = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      TRACKED_PUBLISH_PAYLOAD,
      { Authorization: 'Bearer admin-token' }
    )
    expect(response.status).toBe(200)
    const queueBody = queueSend.mock.calls[0][0] as Record<string, unknown>
    const { batch, message } = createQueueBatch(queueBody)

    await worker.queue(batch, env)

    expect(notificationFetch).toHaveBeenCalledTimes(1)
    expect(message.retry).not.toHaveBeenCalled()
    const recipient = Array.from(db.newsletterSendRecipients.values())[0]
    expect(recipient).toEqual(expect.objectContaining({
      status: 'sending',
      attempts: 1,
    }))
  })

  it('marks tracked recipients retrying when the sender fails', async () => {
    const { env, db, notificationFetch, queueBody, sendId } = await publishTrackedNewsletter()
    notificationFetch.mockResolvedValueOnce(new Response('sender unavailable', { status: 500 }))
    const { batch, message } = createQueueBatch(queueBody)

    await worker.queue(batch, env)

    expect(message.retry).toHaveBeenCalledTimes(1)
    const recipient = Array.from(db.newsletterSendRecipients.values())[0]
    expect(recipient).toEqual(expect.objectContaining({
      status: 'retrying',
      attempts: 1,
      lastError: 'Notification service returned status 500',
    }))
    expect(db.newsletterSends.get(sendId)).toEqual(expect.objectContaining({
      status: 'sending',
      queuedCount: 0,
    }))
  })

  it('marks tracked recipients dead-lettered from the DLQ consumer', async () => {
    const { env, db, notificationFetch, queueBody, sendId } = await publishTrackedNewsletter()
    notificationFetch.mockClear()
    const { batch } = createQueueBatch(queueBody, 'haben-letterdrop-dlq')

    await worker.queue(batch, env)

    expect(notificationFetch).not.toHaveBeenCalled()
    const recipient = Array.from(db.newsletterSendRecipients.values())[0]
    expect(recipient.status).toBe('deadLettered')
    expect(db.newsletterSends.get(sendId)).toEqual(expect.objectContaining({
      status: 'completedWithFailures',
      deadLetteredCount: 1,
    }))
  })
})

describe('stateless newsletter unsubscribe links', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  async function sendQueuedNewsletterAndExtractToken() {
    const { env, db, notificationFetch } = createEnv()
    db.subscribers.set(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`, {
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })
    const fileName = `newsletters/${NEWSLETTER_ID}/unsubscribe.html`
    const textFileName = `newsletters/${NEWSLETTER_ID}/unsubscribe.txt`
    await env.R2.put(fileName, '<p>Body</p>')
    await env.R2.put(textFileName, 'Body')
    const { batch } = createQueueBatch({
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
      subject: 'Unsubscribe test',
      fileName,
      textFileName,
    })

    await worker.queue(batch, env)
    const sendBody = await getNotificationRequestBody(notificationFetch)
    return { env, db, token: extractUnsubscribeToken(sendBody) }
  }

  it('supports RFC 8058 one-click POST unsubscribe', async () => {
    const { env, db, token } = await sendQueuedNewsletterAndExtractToken()

    const response = await postJson(env, `/api/subscribe/list-unsubscribe/${token}`, {})

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      message: 'Unsubscribed successfully',
    })
    expect(db.subscribers.get(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`)?.isSubscribed).toBe(0)
  })

  it('rejects tampered unsubscribe tokens without changing subscriber state', async () => {
    const { env, db, token } = await sendQueuedNewsletterAndExtractToken()
    const tamperedToken = `${token.slice(0, -1)}x`

    const response = await postJson(env, `/api/subscribe/list-unsubscribe/${tamperedToken}`, {})

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid unsubscribe token',
    })
    expect(db.subscribers.get(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`)?.isSubscribed).toBe(1)
  })

  it('renders visible GET unsubscribe confirmation without unsubscribing', async () => {
    const { env, db, token } = await sendQueuedNewsletterAndExtractToken()

    const response = await app.request(
      `https://example.com/api/subscribe/unsubscribe/${token}`,
      {},
      env
    )

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toContain('Confirm unsubscribe')
    expect(db.subscribers.get(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`)?.isSubscribed).toBe(1)
  })

  it('supports visible POST unsubscribe confirmation', async () => {
    const { env, db, token } = await sendQueuedNewsletterAndExtractToken()

    const response = await postJson(env, `/api/subscribe/unsubscribe/${token}`, {})

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toContain('Unsubscribed successfully')
    expect(db.subscribers.get(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`)?.isSubscribed).toBe(0)
  })
})

describe('SES SNS suppression webhook', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('records permanent bounces and unsubscribes matching newsletter subscribers', async () => {
    const { env, db } = createEnv()
    const { signEnvelope } = await createSnsSigner()
    db.subscribers.set(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`, {
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })

    const response = await postJson(env, '/api/ses/sns/ses-webhook-token', await signEnvelope({
      Type: 'Notification',
      TopicArn: env.SES_SNS_TOPIC_ARN,
      Message: JSON.stringify({
        notificationType: 'Bounce',
        mail: {
          messageId: 'ses-message-id',
          tags: { newsletterId: [NEWSLETTER_ID], recipientHash: ['hash'] },
        },
        bounce: {
          bounceType: 'Permanent',
          bouncedRecipients: [{ emailAddress: SUBSCRIBER_EMAIL }],
        },
      }),
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      message: 'SES notification processed',
      recordedCount: 1,
      unsubscribedCount: 1,
    })
    expect(db.subscribers.get(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`)?.isSubscribed).toBe(0)
    expect(db.suppressionEvents[0]).toEqual(expect.objectContaining({
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
      eventType: 'bounce:Permanent',
      providerMessageId: 'ses-message-id',
    }))
  })

  it('updates tracked recipients from SES delivery events', async () => {
    const { env, db, queueSend } = createEnv()
    const { signEnvelope } = await createSnsSigner()
    db.subscribers.set(`${NEWSLETTER_ID}:first@example.com`, {
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })
    const publishResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      TRACKED_PUBLISH_PAYLOAD,
      { Authorization: 'Bearer admin-token' }
    )
    const publishResult = await publishResponse.json() as Record<string, unknown>
    const queueBody = queueSend.mock.calls[0][0] as Record<string, unknown>

    const response = await postJson(env, '/api/ses/sns/ses-webhook-token', await signEnvelope({
      Type: 'Notification',
      TopicArn: env.SES_SNS_TOPIC_ARN,
      Message: JSON.stringify({
        eventType: 'Delivery',
        mail: {
          messageId: 'ses-message-id',
          destination: ['first@example.com'],
          tags: {
            newsletterId: [NEWSLETTER_ID],
            sendId: [publishResult.sendId],
            recipientHash: [queueBody.recipientHash],
          },
        },
        delivery: {
          recipients: ['first@example.com'],
        },
      }),
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      message: 'SES notification processed',
      recordedCount: 0,
      unsubscribedCount: 0,
    })
    const recipient = Array.from(db.newsletterSendRecipients.values())[0]
    expect(recipient.status).toBe('delivered')
    expect(db.newsletterSends.get(String(publishResult.sendId))).toEqual(expect.objectContaining({
      status: 'completed',
      deliveredCount: 1,
    }))
  })

  it('does not reopen terminal recipients when active SES events arrive late', async () => {
    const { env, db, queueSend } = createEnv()
    const { signEnvelope } = await createSnsSigner()
    db.subscribers.set(`${NEWSLETTER_ID}:first@example.com`, {
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })
    const publishResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      TRACKED_PUBLISH_PAYLOAD,
      { Authorization: 'Bearer admin-token' }
    )
    const publishResult = await publishResponse.json() as Record<string, unknown>
    const queueBody = queueSend.mock.calls[0][0] as Record<string, unknown>
    const tags = {
      newsletterId: [NEWSLETTER_ID],
      sendId: [publishResult.sendId],
      recipientHash: [queueBody.recipientHash],
    }

    const deliveryResponse = await postJson(env, '/api/ses/sns/ses-webhook-token', await signEnvelope({
      Type: 'Notification',
      TopicArn: env.SES_SNS_TOPIC_ARN,
      Message: JSON.stringify({
        eventType: 'Delivery',
        mail: {
          messageId: 'ses-message-id',
          destination: ['first@example.com'],
          tags,
        },
        delivery: {
          recipients: ['first@example.com'],
        },
      }),
    }))
    expect(deliveryResponse.status).toBe(200)

    for (const lateNotification of [
      {
        eventType: 'Send',
        mail: {
          messageId: 'ses-message-id',
          destination: ['first@example.com'],
          tags,
        },
      },
      {
        eventType: 'DeliveryDelay',
        mail: {
          messageId: 'ses-message-id',
          destination: ['first@example.com'],
          tags,
        },
        deliveryDelay: {
          delayedRecipients: ['first@example.com'],
          delayType: 'MailboxFull',
        },
      },
    ]) {
      const response = await postJson(env, '/api/ses/sns/ses-webhook-token', await signEnvelope({
        Type: 'Notification',
        TopicArn: env.SES_SNS_TOPIC_ARN,
        Message: JSON.stringify(lateNotification),
      }))
      expect(response.status).toBe(200)
    }

    const recipient = Array.from(db.newsletterSendRecipients.values())[0]
    expect(recipient.status).toBe('delivered')
    expect(db.newsletterSends.get(String(publishResult.sendId))).toEqual(expect.objectContaining({
      status: 'completed',
      providerAcceptedCount: 0,
      deliveredCount: 1,
      deliveryDelayedCount: 0,
    }))
    expect(db.newsletterSendEvents.slice(-2).map((event) => event.eventType)).toEqual([
      'providerSend',
      'deliveryDelayed',
    ])
    expect(db.newsletterSendEvents.slice(-2).map((event) => event.recipientStatus)).toEqual([
      'delivered',
      'delivered',
    ])
  })

  it('keeps sends active for SES delivery delay events', async () => {
    const { env, db, queueSend } = createEnv()
    const { signEnvelope } = await createSnsSigner()
    db.subscribers.set(`${NEWSLETTER_ID}:first@example.com`, {
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })
    const publishResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      TRACKED_PUBLISH_PAYLOAD,
      { Authorization: 'Bearer admin-token' }
    )
    const publishResult = await publishResponse.json() as Record<string, unknown>
    const queueBody = queueSend.mock.calls[0][0] as Record<string, unknown>

    const response = await postJson(env, '/api/ses/sns/ses-webhook-token', await signEnvelope({
      Type: 'Notification',
      TopicArn: env.SES_SNS_TOPIC_ARN,
      Message: JSON.stringify({
        eventType: 'DeliveryDelay',
        mail: {
          messageId: 'ses-message-id',
          destination: ['first@example.com'],
          tags: {
            newsletterId: [NEWSLETTER_ID],
            sendId: [publishResult.sendId],
            recipientHash: [queueBody.recipientHash],
          },
        },
        deliveryDelay: {
          delayedRecipients: ['first@example.com'],
          delayType: 'MailboxFull',
        },
      }),
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      message: 'SES notification processed',
      recordedCount: 0,
      unsubscribedCount: 0,
    })
    const recipient = Array.from(db.newsletterSendRecipients.values())[0]
    expect(recipient.status).toBe('deliveryDelayed')
    expect(db.newsletterSends.get(String(publishResult.sendId))).toEqual(expect.objectContaining({
      status: 'sending',
      deliveryDelayedCount: 1,
    }))
  })

  it('records transient bounces without unsubscribing', async () => {
    const { env, db } = createEnv()
    const { signEnvelope } = await createSnsSigner()
    db.subscribers.set(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`, {
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })

    const response = await postJson(env, '/api/ses/sns/ses-webhook-token', await signEnvelope({
      Type: 'Notification',
      TopicArn: env.SES_SNS_TOPIC_ARN,
      Message: JSON.stringify({
        notificationType: 'Bounce',
        mail: {
          messageId: 'transient-message-id',
          tags: { newsletterId: [NEWSLETTER_ID] },
        },
        bounce: {
          bounceType: 'Transient',
          bouncedRecipients: [{ emailAddress: SUBSCRIBER_EMAIL }],
        },
      }),
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      message: 'SES notification processed',
      recordedCount: 1,
      unsubscribedCount: 0,
    })
    expect(db.subscribers.get(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`)?.isSubscribed).toBe(1)
    expect(db.suppressionEvents[0].eventType).toBe('bounce:Transient')
  })

  it('records complaints and unsubscribes matching newsletter subscribers', async () => {
    const { env, db } = createEnv()
    const { signEnvelope } = await createSnsSigner()
    db.subscribers.set(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`, {
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })

    const response = await postJson(env, '/api/ses/sns/ses-webhook-token', await signEnvelope({
      Type: 'Notification',
      TopicArn: env.SES_SNS_TOPIC_ARN,
      Message: JSON.stringify({
        notificationType: 'Complaint',
        mail: {
          messageId: 'complaint-message-id',
          tags: { newsletterId: [NEWSLETTER_ID] },
        },
        complaint: {
          complainedRecipients: [{ emailAddress: SUBSCRIBER_EMAIL }],
        },
      }),
    }))

    expect(response.status).toBe(200)
    expect(db.subscribers.get(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`)?.isSubscribed).toBe(0)
    expect(db.suppressionEvents[0].eventType).toBe('complaint')
  })

  it('rejects SNS notifications without a valid signature', async () => {
    const { env, db } = createEnv()

    const response = await postJson(env, '/api/ses/sns/ses-webhook-token', {
      Type: 'Notification',
      TopicArn: env.SES_SNS_TOPIC_ARN,
      Message: JSON.stringify({
        notificationType: 'Complaint',
        mail: {
          messageId: 'forged-message-id',
          tags: { newsletterId: [NEWSLETTER_ID] },
        },
        complaint: {
          complainedRecipients: [{ emailAddress: SUBSCRIBER_EMAIL }],
        },
      }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid SNS signature',
    })
    expect(db.suppressionEvents).toEqual([])
  })

  it('confirms signed SNS subscriptions by fetching SubscribeURL', async () => {
    const { env } = createEnv()
    const { fetchSpy, signEnvelope, subscribeUrl } = await createSnsSigner()

    const response = await postJson(env, '/api/ses/sns/ses-webhook-token', await signEnvelope({
      Type: 'SubscriptionConfirmation',
      TopicArn: env.SES_SNS_TOPIC_ARN,
      Token: 'confirmation-token',
      SubscribeURL: subscribeUrl,
      Message: 'Confirm the subscription',
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      message: 'SNS subscription confirmed',
    })
    expect(fetchSpy).toHaveBeenCalledWith(subscribeUrl, { method: 'GET' })
  })
})

describe('single-use subscription tokens', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('enforces single-use confirm tokens', async () => {
    const { env, kv } = createEnv()
    const token = 'confirm-token'
    await kv.put(token, JSON.stringify({
      action: 'confirm',
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
    }))

    const firstResponse = await app.request(`https://example.com/api/subscribe/confirm/${token}`, {}, env)
    expect(firstResponse.status).toBe(302)
    expect(firstResponse.headers.get('location')).toBe('https://habengirma.com/subscription-successful/')

    const replayResponse = await app.request(`https://example.com/api/subscribe/confirm/${token}`, {}, env)
    expect(replayResponse.status).toBe(400)
    await expect(replayResponse.json()).resolves.toEqual({ error: 'Invalid or expired token' })
  })

  it('enforces single-use cancel tokens and preserves locale rendering', async () => {
    const { env, db, kv } = createEnv()
    const subscriberKey = `${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`
    db.subscribers.set(subscriberKey, {
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })

    const token = 'cancel-token'
    await kv.put(token, JSON.stringify({
      action: 'cancel',
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
    }))

    const firstResponse = await app.request(`https://example.com/api/subscribe/cancel/${token}`, {
      headers: { 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
    }, env)
    expect(firstResponse.status).toBe(200)
    await expect(firstResponse.text()).resolves.toContain('取消订阅成功')
    expect(db.subscribers.get(subscriberKey)?.isSubscribed).toBe(0)

    const replayResponse = await app.request(`https://example.com/api/subscribe/cancel/${token}`, {}, env)
    expect(replayResponse.status).toBe(400)
    await expect(replayResponse.json()).resolves.toEqual({ error: 'Invalid or expired token' })
  })
})

describe('anti-abuse enforcement', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('applies pre-turnstile throttling before Turnstile verification', async () => {
    const { env } = createEnv({
      denyBuckets: ['subscribe-confirmation-precheck-ip'],
    })
    const turnstileFetch = vi.fn(async () => (
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ))
    vi.stubGlobal('fetch', turnstileFetch)

    const response = await postJson(env, '/api/subscribe/send-confirmation', {
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
      turnstileToken: 'token',
    }, {
      'CF-Connecting-IP': '203.0.113.10',
    })

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(turnstileFetch).not.toHaveBeenCalled()
  })

  it('applies pre-turnstile throttling on cancellation requests', async () => {
    const { env } = createEnv({
      denyBuckets: ['subscribe-cancellation-precheck-ip'],
    })
    const turnstileFetch = vi.fn(async () => (
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ))
    vi.stubGlobal('fetch', turnstileFetch)

    const response = await postJson(env, '/api/subscribe/send-cancellation', {
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
      turnstileToken: 'token',
    }, {
      'CF-Connecting-IP': '203.0.113.14',
    })

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(turnstileFetch).not.toHaveBeenCalled()
  })

  it('rejects failed Turnstile checks before post-verification throttles run', async () => {
    const { env, db } = createEnv()
    vi.stubGlobal('fetch', vi.fn(async () => (
      new Response(JSON.stringify({ success: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )))

    const response = await postJson(env, '/api/subscribe/send-confirmation', {
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
      turnstileToken: 'token',
    }, {
      'CF-Connecting-IP': '203.0.113.11',
    })

    expect(response.status).toBe(403)
    expect(db.attemptedRateLimitBuckets).toEqual(['subscribe-confirmation-precheck-ip'])
  })

  it('applies post-verification per-target throttling with Retry-After', async () => {
    const { env, db } = createEnv({
      denyBuckets: ['subscribe-confirmation-target'],
    })
    vi.stubGlobal('fetch', vi.fn(async () => (
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )))

    const response = await postJson(env, '/api/subscribe/send-confirmation', {
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
      turnstileToken: 'token',
    }, {
      'CF-Connecting-IP': '203.0.113.12',
    })

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('3600')
    expect(db.attemptedRateLimitBuckets).toEqual([
      'subscribe-confirmation-precheck-ip',
      'subscribe-confirmation-ip',
      'subscribe-confirmation-target',
    ])
  })

  it('fails open with a clear response when AbuseEvent migration is missing', async () => {
    const { env, notificationFetch } = createEnv({
      missingAbuseEventTable: true,
    })
    vi.stubGlobal('fetch', vi.fn(async () => (
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )))

    const response = await postJson(env, '/api/subscribe/send-confirmation', {
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
      turnstileToken: 'token',
      firstName: 'Ada',
      lastName: 'Lovelace',
    }, {
      'CF-Connecting-IP': '203.0.113.13',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ message: 'Confirmation email sent' })
    expect(notificationFetch).toHaveBeenCalledTimes(1)
  })
})
