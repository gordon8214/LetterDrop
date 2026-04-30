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
  upsertedAt?: string
  subscribedAt?: string | null
  unsubscribedAt?: string | null
  deletedAt?: string | null
}

type FakeDatabaseOptions = {
  denyBuckets?: string[]
  missingAbuseEventTable?: boolean
  failRecipientStatusUpdates?: string[]
  failFanoutAdvanceOnce?: boolean
  failQueueSendOnce?: boolean
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
  fanoutQueuedCount: number
  sendingCount: number
  retryingCount: number
  queueFailedCount: number
  providerAcceptedCount: number
  deliveredCount: number
  deliveryDelayedCount: number
  bouncedCount: number
  complainedCount: number
  failedCount: number
  deadLetteredCount: number
  needsReviewCount: number
  lastError: string | null
  contentFileName: string | null
  textFileName: string | null
  fromName: string | null
  fanoutSnapshotAt: string | null
  fanoutCursorEmail: string | null
  fanoutCompletedAt: string | null
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
  needsReviewAt: string | null
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
  operationCount = 0

  private readonly denyBuckets: Set<string>
  private readonly missingAbuseEventTable: boolean
  private readonly failRecipientStatusUpdates: Set<string>
  private failFanoutAdvanceOnce: boolean
  private sourceMessageLookupMisses = 0
  private nextNewsletterSendEventId = 1

  constructor(options: FakeDatabaseOptions = {}) {
    this.denyBuckets = new Set(options.denyBuckets ?? [])
    this.missingAbuseEventTable = options.missingAbuseEventTable ?? false
    this.failRecipientStatusUpdates = new Set(options.failRecipientStatusUpdates ?? [])
    this.failFanoutAdvanceOnce = options.failFanoutAdvanceOnce ?? false
  }

  prepare(sql: string): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(this, sql)
  }

  missNextSourceMessageLookup() {
    this.sourceMessageLookupMisses += 1
  }

  resetOperationCount() {
    this.operationCount = 0
  }

  async batch(statements: Array<FakeD1PreparedStatement>) {
    return Promise.all(statements.map((statement) => statement.run()))
  }

  async first<T>(sql: string, params: unknown[]): Promise<T | null> {
    this.operationCount += 1
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

    if (normalized.includes('select count(*) as subscribercount from subscriber')) {
      const newsletterId = String(params[0] ?? '')
      const snapshotAt = String(params[1] ?? '9999-12-31T23:59:59.999Z')
      const subscriberCount = Array.from(this.subscribers.values())
        .filter((subscriber) => (
          subscriber.newsletterId === newsletterId &&
          subscriberEligibleAt(subscriber, snapshotAt)
        )).length
      return ({ subscriberCount } as T)
    }

    if (normalized.includes('select coalesce(max(id), 0) as lasteventid from newslettersendevent')) {
      const sendId = String(params[0] ?? '')
      const lastEventId = this.newsletterSendEvents
        .filter((event) => event.sendId === sendId)
        .reduce((maxId, event) => Math.max(maxId, event.id), 0)
      return ({ lastEventId } as T)
    }

    if (normalized.includes('from newslettersendrecipient') && normalized.includes('count(*) as recipientcount')) {
      const sendId = String(params[0] ?? '')
      const recipients = Array.from(this.newsletterSendRecipients.values())
        .filter((recipient) => recipient.sendId === sendId)
      const countStatus = (status: string) => recipients.filter((recipient) => recipient.status === status).length
      return ({
        recipientCount: recipients.length,
        queuedCount: countStatus('queued'),
        sendingCount: countStatus('sending'),
        retryingCount: countStatus('retrying'),
        queueFailedCount: recipients.filter((recipient) => recipient.status === 'failed' && recipient.failureType === 'queue').length,
        providerAcceptedCount: countStatus('providerAccepted'),
        deliveredCount: countStatus('delivered'),
        deliveryDelayedCount: countStatus('deliveryDelayed'),
        bouncedCount: countStatus('bounced'),
        complainedCount: countStatus('complained'),
        failedCount: recipients.filter((recipient) => recipient.status === 'failed' && recipient.failureType !== 'queue').length,
        deadLetteredCount: countStatus('deadLettered'),
        needsReviewCount: countStatus('needsReview'),
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

    if (normalized.includes('from newslettersend') && normalized.includes('where newsletter_id = ? and source_message_id = ?')) {
      if (this.sourceMessageLookupMisses > 0) {
        this.sourceMessageLookupMisses -= 1
        return null
      }

      const newsletterId = String(params[0] ?? '')
      const sourceMessageId = String(params[1] ?? '')
      const send = Array.from(this.newsletterSends.values())
        .filter((candidate) => (
          candidate.newsletterId === newsletterId &&
          candidate.sourceMessageId === sourceMessageId
        ))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null
      return send as T | null
    }

    return null
  }

  async all<T>(sql: string, params: unknown[]): Promise<{ results: T[] }> {
    this.operationCount += 1
    const normalized = normalizeSql(sql)

    if (normalized.includes('select email from subscriber where newsletter_id = ?')) {
      const newsletterId = String(params[0] ?? '')
      const snapshotAt = String(params[1] ?? '9999-12-31T23:59:59.999Z')
      const hasCursor = normalized.includes('email collate nocase > ?')
      const cursor = hasCursor ? String(params[4] ?? '') : null
      const limitParam = hasCursor ? params[5] : params[4]
      const limit = Number(limitParam ?? Number.MAX_SAFE_INTEGER)
      const subscribers = Array.from(this.subscribers.values())
        .filter((subscriber) => (
          subscriber.newsletterId === newsletterId &&
          subscriberEligibleAt(subscriber, snapshotAt) &&
          (!cursor || subscriber.email.localeCompare(cursor, undefined, { sensitivity: 'base' }) > 0)
        ))
        .sort((a, b) => a.email.localeCompare(b.email))
        .slice(0, limit)
        .map((subscriber) => ({ email: subscriber.email }))
      return { results: subscribers as T[] }
    }

    if (normalized.includes('from newslettersendrecipient') && normalized.includes('where send_id = ?')) {
      const sendId = String(params[0] ?? '')
      let index = 1
      const hasCursor = normalized.includes('email collate nocase > ?')
      const cursor = hasCursor ? String(params[index++] ?? '') : null
      const hasStatus = normalized.includes('status = ?')
      const status = hasStatus ? String(params[index++] ?? '') : null
      const hasQuery = normalized.includes("email like ? escape '\\'")
      const query = hasQuery ? String(params[index++] ?? '').replace(/^%|%$/g, '').toLowerCase() : null
      const limit = normalized.includes('limit ?')
        ? Number(params[index] ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER
      const recipients = Array.from(this.newsletterSendRecipients.values())
        .filter((recipient) => (
          recipient.sendId === sendId &&
          (!cursor || recipient.email.localeCompare(cursor, undefined, { sensitivity: 'base' }) > 0) &&
          (!status || recipient.status === status) &&
          (!query || recipient.email.toLowerCase().includes(query))
        ))
        .sort((a, b) => a.email.localeCompare(b.email))
        .slice(0, limit)
      return { results: recipients as T[] }
    }

    if (normalized.includes('from newslettersendevent') && normalized.includes('where send_id = ? order by id desc')) {
      const sendId = String(params[0] ?? '')
      const limit = Number(params[1] ?? Number.MAX_SAFE_INTEGER)
      const events = this.newsletterSendEvents
        .filter((event) => event.sendId === sendId)
        .sort((a, b) => b.id - a.id)
        .slice(0, limit)
      return { results: events as T[] }
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
    this.operationCount += 1
    const normalized = normalizeSql(sql)

    if (normalized.includes('insert into subscriber')) {
      const email = String(params[0] ?? '')
      const firstName = normalizeNameParam(params[1])
      const lastName = normalizeNameParam(params[2])
      const newsletterId = String(params[3] ?? '')
      const upsertedAt = String(params[4] ?? new Date().toISOString())
      const subscribedAt = String(params[5] ?? upsertedAt)
      const key = `${newsletterId}:${email}`
      const existing = this.subscribers.get(key)
      this.subscribers.set(key, {
        email,
        newsletterId,
        firstName: firstName ?? existing?.firstName ?? null,
        lastName: lastName ?? existing?.lastName ?? null,
        isSubscribed: 1,
        upsertedAt,
        subscribedAt: existing?.isSubscribed === 1
          ? existing.subscribedAt ?? subscribedAt
          : subscribedAt,
        unsubscribedAt: null,
        deletedAt: null,
      })
      return { meta: { changes: 1 } }
    }

    if (normalized.includes('update subscriber set issubscribed = 0')) {
      const hasTimestamp = normalized.includes('upsertedat = ?')
      const now = hasTimestamp ? String(params[0] ?? '') : new Date().toISOString()
      const hasDeletedAt = normalized.includes('deleted_at = ?')
      const emailIndex = hasTimestamp ? (hasDeletedAt ? 3 : 2) : 0
      const email = String(params[emailIndex] ?? '')
      const newsletterId = String(params[emailIndex + 1] ?? '')
      const key = `${newsletterId}:${email}`
      const existing = this.subscribers.get(key) ?? {
        email,
        newsletterId,
        firstName: null,
        lastName: null,
        isSubscribed: 0,
      }
      existing.isSubscribed = 0
      existing.upsertedAt = now
      existing.unsubscribedAt = existing.unsubscribedAt ?? now
      if (hasDeletedAt) {
        existing.deletedAt = String(params[2] ?? now)
      }
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

    if (normalized.includes('into newslettersendrecipient')) {
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
        needsReviewAt: null,
        updatedAt: String(params[7] ?? ''),
      }
      if (this.newsletterSendRecipients.has(`${recipient.sendId}:${recipient.recipientHash}`)) {
        return { meta: { changes: 0 } }
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
      const newsletterId = String(params[1] ?? '')
      const sourceMessageId = params[3] === null ? null : String(params[3] ?? '')
      if (
        sourceMessageId &&
        Array.from(this.newsletterSends.values()).some((existingSend) => (
          existingSend.newsletterId === newsletterId &&
          existingSend.sourceMessageId === sourceMessageId
        ))
      ) {
        throw new Error(
          'D1_ERROR: UNIQUE constraint failed: NewsletterSend.newsletter_id, NewsletterSend.source_message_id'
        )
      }

      const send: NewsletterSendRecord = {
        id: String(params[0] ?? ''),
        newsletterId,
        subject: String(params[2] ?? ''),
        sourceMessageId,
        status: String(params[4] ?? ''),
        recipientCount: Number(params[5] ?? 0),
        queuedCount: 0,
        fanoutQueuedCount: 0,
        sendingCount: 0,
        retryingCount: 0,
        queueFailedCount: 0,
        providerAcceptedCount: 0,
        deliveredCount: 0,
        deliveryDelayedCount: 0,
        bouncedCount: 0,
        complainedCount: 0,
        failedCount: 0,
        deadLetteredCount: 0,
        needsReviewCount: 0,
        lastError: null,
        contentFileName: params[6] === null ? null : String(params[6] ?? ''),
        textFileName: params[7] === null ? null : String(params[7] ?? ''),
        fromName: params[8] === null ? null : String(params[8] ?? ''),
        fanoutSnapshotAt: params[9] === null ? null : String(params[9] ?? ''),
        fanoutCursorEmail: null,
        fanoutCompletedAt: null,
        createdAt: String(params[10] ?? ''),
        updatedAt: String(params[11] ?? ''),
        completedAt: null,
      }
      this.newsletterSends.set(send.id, send)
      return { meta: { changes: 1 } }
    }

    if (normalized.includes('update newslettersendrecipient') && normalized.includes('and status = ?')) {
      const status = String(params[0] ?? '')
      const timestamp = String(params[1] ?? '')
      const updatedAt = String(params[2] ?? '')
      const sendId = String(params[3] ?? '')
      const recipientHash = String(params[4] ?? '')
      const newsletterId = String(params[5] ?? '')
      const expectedStatus = String(params[6] ?? '')
      const recipient = this.newsletterSendRecipients.get(`${sendId}:${recipientHash}`)
      if (
        recipient &&
        recipient.newsletterId === newsletterId &&
        recipient.status === expectedStatus
      ) {
        recipient.status = status
        recipient.attempts += 1
        recipient.lastError = null
        recipient.failureType = null
        recipient.sendingAt = timestamp
        recipient.updatedAt = updatedAt
        return { meta: { changes: 1 } }
      }
      return { meta: { changes: 0 } }
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
        'needsreviewat = ?',
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
          if (normalized.includes('needsreviewat = ?')) recipient.needsReviewAt = timestamp
        }
      }
      return { meta: { changes: recipient ? 1 : 0 } }
    }

    if (normalized.includes('update newslettersend') && normalized.includes('queued_count = max(queued_count + ?')) {
      const sendId = String(params[14] ?? '')
      const send = this.newsletterSends.get(sendId)
      if (send) {
        send.queuedCount = Math.max(send.queuedCount + Number(params[0] ?? 0), 0)
        send.sendingCount = Math.max(send.sendingCount + Number(params[1] ?? 0), 0)
        send.retryingCount = Math.max(send.retryingCount + Number(params[2] ?? 0), 0)
        send.queueFailedCount = Math.max(send.queueFailedCount + Number(params[3] ?? 0), 0)
        send.providerAcceptedCount = Math.max(send.providerAcceptedCount + Number(params[4] ?? 0), 0)
        send.deliveredCount = Math.max(send.deliveredCount + Number(params[5] ?? 0), 0)
        send.deliveryDelayedCount = Math.max(send.deliveryDelayedCount + Number(params[6] ?? 0), 0)
        send.bouncedCount = Math.max(send.bouncedCount + Number(params[7] ?? 0), 0)
        send.complainedCount = Math.max(send.complainedCount + Number(params[8] ?? 0), 0)
        send.failedCount = Math.max(send.failedCount + Number(params[9] ?? 0), 0)
        send.deadLetteredCount = Math.max(send.deadLetteredCount + Number(params[10] ?? 0), 0)
        send.needsReviewCount = Math.max(send.needsReviewCount + Number(params[11] ?? 0), 0)
        if (params[12] !== null) {
          send.lastError = String(params[12] ?? '')
        }
        send.updatedAt = String(params[13] ?? '')
      }
      return { meta: { changes: send ? 1 : 0 } }
    }

    if (normalized.includes('update newslettersend') && normalized.includes('fanout_cursor_email = ?')) {
      const hasExpectedCursor = normalized.includes('fanout_cursor_email = ?')
        && !normalized.includes('fanout_cursor_email is null')
      const sendId = String(params[5] ?? '')
      const send = this.newsletterSends.get(sendId)
      const expectedCursor = hasExpectedCursor ? String(params[6] ?? '') : null
      const cursorMatches = send && (
        hasExpectedCursor
          ? send.fanoutCursorEmail === expectedCursor
          : send.fanoutCursorEmail === null
      )
      if (send && send.fanoutCompletedAt === null && cursorMatches) {
        if (this.failFanoutAdvanceOnce) {
          this.failFanoutAdvanceOnce = false
          throw new Error('Simulated fanout advance failure')
        }
        send.queuedCount += Number(params[0] ?? 0)
        send.fanoutQueuedCount += Number(params[1] ?? 0)
        send.fanoutCursorEmail = params[2] === null ? null : String(params[2] ?? '')
        if (params[3] !== null) {
          send.fanoutCompletedAt = String(params[3] ?? '')
        }
        send.updatedAt = String(params[4] ?? '')
        return { meta: { changes: 1 } }
      }
      return { meta: { changes: 0 } }
    }

    if (normalized.includes('update newslettersend') && normalized.includes('queue_failed_count = queue_failed_count + ?')) {
      const sendId = String(params[4] ?? '')
      const send = this.newsletterSends.get(sendId)
      if (send) {
        send.queueFailedCount += Number(params[0] ?? 0)
        send.fanoutCompletedAt = String(params[1] ?? '')
        send.lastError = String(params[2] ?? '')
        send.updatedAt = String(params[3] ?? '')
      }
      return { meta: { changes: send ? 1 : 0 } }
    }

    if (normalized.includes('update newslettersend') && normalized.includes('set status = ?')) {
      const sendId = String(params[3] ?? '')
      const send = this.newsletterSends.get(sendId)
      if (send) {
        send.status = String(params[0] ?? '')
        send.completedAt = params[1] === null ? null : String(params[1] ?? '')
        send.updatedAt = String(params[2] ?? '')
      }
      return { meta: { changes: send ? 1 : 0 } }
    }

    if (normalized.includes('update newslettersend')) {
      const sendId = String(params[15] ?? '')
      const send = this.newsletterSends.get(sendId)
      if (send) {
        send.status = String(params[0] ?? '')
        send.recipientCount = Number(params[1] ?? 0)
        send.queuedCount = Number(params[2] ?? 0)
        send.sendingCount = Number(params[3] ?? 0)
        send.retryingCount = Number(params[4] ?? 0)
        send.queueFailedCount = Number(params[5] ?? 0)
        send.providerAcceptedCount = Number(params[6] ?? 0)
        send.deliveredCount = Number(params[7] ?? 0)
        send.deliveryDelayedCount = Number(params[8] ?? 0)
        send.bouncedCount = Number(params[9] ?? 0)
        send.complainedCount = Number(params[10] ?? 0)
        send.failedCount = Number(params[11] ?? 0)
        send.deadLetteredCount = Number(params[12] ?? 0)
        send.needsReviewCount = Number(params[13] ?? 0)
        if (params[14] !== null) {
          send.lastError = String(params[14] ?? '')
        }
        send.updatedAt = String(params[15] ?? '')
        send.completedAt = params[16] === null ? null : String(params[16] ?? '')
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

function subscriberSubscribedAt(subscriber: SubscriberRecord) {
  return subscriber.subscribedAt ?? subscriber.upsertedAt ?? '1970-01-01T00:00:00.000Z'
}

function subscriberEligibleAt(subscriber: SubscriberRecord, snapshotAt: string) {
  const subscribedAt = subscriberSubscribedAt(subscriber)
  if (subscriber.isSubscribed !== 1 && !subscriber.unsubscribedAt) {
    return false
  }
  return subscriber.newsletterId.length > 0 &&
    subscribedAt <= snapshotAt &&
    (subscriber.unsubscribedAt === undefined || subscriber.unsubscribedAt === null || subscriber.unsubscribedAt > snapshotAt) &&
    (subscriber.deletedAt === undefined || subscriber.deletedAt === null || subscriber.deletedAt > snapshotAt)
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
  let shouldFailQueueSend = options.failQueueSendOnce ?? false
  const queueSend = vi.fn(async () => {
    if (shouldFailQueueSend) {
      shouldFailQueueSend = false
      throw new Error('Simulated queue send failure')
    }
  })
  const queueSendBatch = vi.fn()
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
    QUEUE: {
      send: queueSend,
      sendBatch: queueSendBatch,
    } as unknown as Queue,
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
    queueSendBatch,
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

async function drainFirstFanoutJob(
  env: ReturnType<typeof createEnv>['env'],
  queueSend: ReturnType<typeof vi.fn>,
  queueSendBatch: ReturnType<typeof vi.fn>
) {
  const fanoutBody = queueSend.mock.calls.at(-1)?.[0] as Record<string, unknown>
  const fanout = createQueueBatch(fanoutBody)
  await worker.queue(fanout.batch, env)
  expect(fanout.message.retry).not.toHaveBeenCalled()
  const batchMessages = queueSendBatch.mock.calls.at(-1)?.[0] as Array<{
    body: Record<string, unknown>
  }>
  return batchMessages.map((entry) => entry.body)
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
    .join('\n') + '\n'
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
      '/api/newsletter/ses-diagnostics',
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
    await expect(response.json()).resolves.toEqual({
      emailAddress: 'publish@example.com',
      fromName: null,
    })
  })

  it('stores, returns, and clears the sender display name', async () => {
    const { env } = createEnv()

    const saveResponse = await app.request('https://example.com/api/newsletter/publish-config', {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer admin-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fromName: '  Haben Girma  ' }),
    }, env)
    const getResponse = await app.request('https://example.com/api/newsletter/publish-config', {
      headers: { Authorization: 'Bearer admin-token' },
    }, env)
    const clearResponse = await app.request('https://example.com/api/newsletter/publish-config', {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer admin-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fromName: '   ' }),
    }, env)

    expect(saveResponse.status).toBe(200)
    await expect(saveResponse.json()).resolves.toEqual({
      emailAddress: 'publish@example.com',
      fromName: 'Haben Girma',
    })
    expect(getResponse.status).toBe(200)
    await expect(getResponse.json()).resolves.toEqual({
      emailAddress: 'publish@example.com',
      fromName: 'Haben Girma',
    })
    expect(clearResponse.status).toBe(200)
    await expect(clearResponse.json()).resolves.toEqual({
      emailAddress: 'publish@example.com',
      fromName: null,
    })
  })

  it('rejects invalid sender display names', async () => {
    const { env } = createEnv()

    const response = await app.request('https://example.com/api/newsletter/publish-config', {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer admin-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fromName: 'Bad <Name>' }),
    }, env)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'fromName contains invalid characters',
    })
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

describe('SES diagnostics admin endpoint', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('proxies SES diagnostics through the notification service binding', async () => {
    const { env, notificationFetch } = createEnv()
    const diagnostics = {
      ok: true,
      region: 'us-west-1',
      fromAddress: 'contact@habengirma.com',
      configurationSetName: 'haben-letterdrop',
      checks: [
        {
          id: 'account',
          label: 'SES account',
          status: 'passed',
          message: 'SES account sending is enabled with production access.',
        },
      ],
    }
    notificationFetch.mockResolvedValueOnce(new Response(JSON.stringify(diagnostics), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const response = await app.request('https://example.com/api/newsletter/ses-diagnostics', {
      headers: { Authorization: 'Bearer admin-token' },
    }, env)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(diagnostics)
    const request = notificationFetch.mock.calls[0]?.[0] as Request
    expect(request.url).toBe('http://haben-notification/diagnostics/ses')
    expect(request.method).toBe('GET')
    expect(request.headers.get('X-LetterDrop-Notification-Token')).toBe('notification-secret')
  })

  it('fails closed when the notification shared secret is missing', async () => {
    const { env, notificationFetch } = createEnv()
    env.NOTIFICATION_SHARED_SECRET = ''

    const response = await app.request('https://example.com/api/newsletter/ses-diagnostics', {
      headers: { Authorization: 'Bearer admin-token' },
    }, env)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Notification service unavailable',
    })
    expect(notificationFetch).not.toHaveBeenCalled()
  })

  it('returns notification diagnostics errors to the admin client', async () => {
    const { env, notificationFetch } = createEnv()
    notificationFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      message: 'error',
      detail: 'Email sender unavailable',
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    }))

    const response = await app.request('https://example.com/api/newsletter/ses-diagnostics', {
      headers: { Authorization: 'Bearer admin-token' },
    }, env)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Email sender unavailable',
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

  it('rejects direct publishes without sourceMessageId before queueing', async () => {
    const { env, queueSend } = createEnv()

    const response = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      {
        subject: publishPayload.subject,
        html: publishPayload.html,
        text: publishPayload.text,
      },
      { Authorization: 'Bearer admin-token' }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'sourceMessageId is required' })
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

  it('stores newsletter HTML and queues subscriber fanout', async () => {
    const { env, db, r2Put, queueSend, queueSendBatch } = createEnv()
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
      queuedCount: 0,
      recipientCount: 1,
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
      kind: 'fanout',
      newsletterId: NEWSLETTER_ID,
      subject: 'Direct title: spaces & symbols',
      fileName: result.fileName,
      textFileName: result.textFileName,
      sendId: result.sendId,
      cursorEmail: null,
    }))
    expect(db.newsletterSends.get(result.sendId)?.queuedCount).toBe(0)
    expect(db.newsletterSendRecipients.size).toBe(0)
    const recipientMessages = await drainFirstFanoutJob(env, queueSend, queueSendBatch)
    expect(recipientMessages).toHaveLength(1)
    expect(recipientMessages[0]).toEqual(expect.objectContaining({
      kind: 'recipient',
      email: 'first@example.com',
      recipientHash: expect.any(String),
    }))
    expect(db.newsletterSends.get(result.sendId)?.queuedCount).toBe(1)
    expect(db.newsletterSendRecipients.size).toBe(1)
  })

  it('snapshots the configured sender display name onto queued recipients', async () => {
    const { env, db, queueSend, queueSendBatch } = createEnv()
    await env.KV.put('publish-config', JSON.stringify({ fromName: 'Haben Girma' }))
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
      publishPayload,
      { Authorization: 'Bearer admin-token' }
    )

    expect(response.status).toBe(200)
    expect(queueSend).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'fanout',
      fromName: 'Haben Girma',
    }))
  })

  it('dry-runs large publishes without storing content or queueing work', async () => {
    const { env, db, r2Put, queueSend, queueSendBatch, notificationFetch } = createEnv()
    for (let index = 0; index < 5000; index += 1) {
      const email = `subscriber-${String(index).padStart(4, '0')}@example.com`
      db.subscribers.set(`${NEWSLETTER_ID}:${email}`, {
        email,
        newsletterId: NEWSLETTER_ID,
        firstName: null,
        lastName: null,
        isSubscribed: 1,
      })
    }

    const response = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish/dry-run`,
      publishPayload,
      { Authorization: 'Bearer admin-token' }
    )
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result).toEqual(expect.objectContaining({
      newsletterId: NEWSLETTER_ID,
      recipientCount: 5000,
      estimatedFanoutChunks: 334,
      estimatedRecipientQueueBatches: 334,
      fanoutChunkSize: 15,
      wouldSendEmail: false,
      freePlanSafe: true,
      duplicate: false,
    }))
    expect(r2Put).not.toHaveBeenCalled()
    expect(queueSend).not.toHaveBeenCalled()
    expect(queueSendBatch).not.toHaveBeenCalled()
    expect(notificationFetch).not.toHaveBeenCalled()
  })

  it('fans out five thousand subscribers in bounded queue chunks', async () => {
    const { env, db, queueSend, queueSendBatch } = createEnv()
    for (let index = 0; index < 5000; index += 1) {
      const email = `subscriber-${String(index).padStart(4, '0')}@example.com`
      db.subscribers.set(`${NEWSLETTER_ID}:${email}`, {
        email,
        newsletterId: NEWSLETTER_ID,
        firstName: null,
        lastName: null,
        isSubscribed: 1,
      })
    }

    const response = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      publishPayload,
      { Authorization: 'Bearer admin-token' }
    )
    const result = await response.json() as { sendId: string }
    expect(response.status).toBe(200)
    expect(queueSend).toHaveBeenCalledTimes(1)
    expect(db.newsletterSendRecipients.size).toBe(0)

    const operationCounts: number[] = []
    let fanoutIndex = 0
    while (fanoutIndex < queueSend.mock.calls.length) {
      const fanoutBody = queueSend.mock.calls[fanoutIndex][0] as Record<string, unknown>
      expect(fanoutBody).toEqual(expect.objectContaining({ kind: 'fanout' }))
      db.resetOperationCount()
      const { batch, message } = createQueueBatch(fanoutBody)
      await worker.queue(batch, env)
      expect(message.retry).not.toHaveBeenCalled()
      operationCounts.push(db.operationCount)
      fanoutIndex += 1
    }

    const recipientMessageCount = queueSendBatch.mock.calls.reduce((sum, call) => (
      sum + (call[0] as Array<unknown>).length
    ), 0)
    const maxFanoutBatchSize = Math.max(...queueSendBatch.mock.calls.map((call) => (
      (call[0] as Array<unknown>).length
    )))
    expect(queueSendBatch).toHaveBeenCalledTimes(334)
    expect(recipientMessageCount).toBe(5000)
    expect(maxFanoutBatchSize).toBeLessThanOrEqual(15)
    expect(Math.max(...operationCounts)).toBeLessThanOrEqual(50)
    expect(db.newsletterSendRecipients.size).toBe(5000)
    expect(db.newsletterSends.get(result.sendId)).toEqual(expect.objectContaining({
      recipientCount: 5000,
      queuedCount: 5000,
      fanoutCompletedAt: expect.any(String),
    }))

    const recipientsResponse = await app.request(
      `https://example.com/api/newsletter/${NEWSLETTER_ID}/sends/${result.sendId}/recipients?limit=100`,
      { headers: { Authorization: 'Bearer admin-token' } },
      env
    )
    const recipientPage = await recipientsResponse.json() as {
      recipients: Array<Record<string, unknown>>
      pagination: { hasMore: boolean; nextCursor: string | null }
    }
    expect(recipientsResponse.status).toBe(200)
    expect(recipientPage.recipients).toHaveLength(100)
    expect(recipientPage.pagination.hasMore).toBe(true)
    expect(recipientPage.pagination.nextCursor).toBe('subscriber-0099@example.com')
  })

  it('requeues duplicate direct publishes while fanout is incomplete', async () => {
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
    expect(queueSend).toHaveBeenCalledTimes(2)
  })

  it('returns duplicate direct sends before validating mutable body fields and requeues incomplete fanout', async () => {
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
      {
        ...publishPayload,
        subject: '   ',
        html: '',
        text: '',
      },
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
    expect(queueSend).toHaveBeenCalledTimes(2)
  })

  it('returns existing sends when the D1 source-message unique index wins a race', async () => {
    const { env, db, queueSend, queueSendBatch } = createEnv()
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
    const firstResult = await firstResponse.json() as { sendId: string }
    queueSend.mockClear()
    db.missNextSourceMessageLookup()

    const secondResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      publishPayload,
      { Authorization: 'Bearer admin-token' }
    )

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    await expect(secondResponse.json()).resolves.toEqual(expect.objectContaining({
      sendId: firstResult.sendId,
      queuedCount: 0,
      queueFailedCount: 0,
      duplicate: true,
    }))
    expect(queueSend).toHaveBeenCalledTimes(1)
  })

  it('recovers a send when the initial fanout enqueue fails', async () => {
    const { env, db, queueSend } = createEnv({ failQueueSendOnce: true })
    db.subscribers.set(`${NEWSLETTER_ID}:first@example.com`, {
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })

    const failedResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      publishPayload,
      { Authorization: 'Bearer admin-token' }
    )
    const retryResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      publishPayload,
      { Authorization: 'Bearer admin-token' }
    )
    const retryResult = await retryResponse.json() as { duplicate: boolean; sendId: string }

    expect(failedResponse.status).toBe(500)
    expect(retryResponse.status).toBe(200)
    expect(retryResult.duplicate).toBe(true)
    expect(db.newsletterSends.get(retryResult.sendId)).toEqual(expect.objectContaining({
      contentFileName: expect.stringMatching(/\.html$/),
      fanoutSnapshotAt: expect.any(String),
    }))
    expect(queueSend).toHaveBeenCalledTimes(2)
    expect(queueSend.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      kind: 'fanout',
      sendId: retryResult.sendId,
      cursorEmail: null,
    }))
  })

  it('keeps fanout counters idempotent when D1 advance fails after sendBatch', async () => {
    const { env, db, queueSend, queueSendBatch } = createEnv({ failFanoutAdvanceOnce: true })
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
      publishPayload,
      { Authorization: 'Bearer admin-token' }
    )
    const result = await response.json() as { sendId: string }
    const fanoutBody = queueSend.mock.calls[0][0] as Record<string, unknown>
    const firstFanout = createQueueBatch(fanoutBody)

    await worker.queue(firstFanout.batch, env)

    expect(firstFanout.message.retry).toHaveBeenCalledTimes(1)
    expect(queueSendBatch).toHaveBeenCalledTimes(1)
    expect(db.newsletterSends.get(result.sendId)).toEqual(expect.objectContaining({
      queuedCount: 0,
      fanoutQueuedCount: 0,
    }))

    const secondFanout = createQueueBatch(fanoutBody)
    await worker.queue(secondFanout.batch, env)

    expect(secondFanout.message.retry).not.toHaveBeenCalled()
    expect(queueSendBatch).toHaveBeenCalledTimes(2)
    expect(db.newsletterSends.get(result.sendId)).toEqual(expect.objectContaining({
      queuedCount: 1,
      fanoutQueuedCount: 1,
      fanoutCompletedAt: expect.any(String),
    }))
  })

  it('uses publish-time subscriber eligibility while fanout drains later', async () => {
    const { env, db, queueSend, queueSendBatch } = createEnv()
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
      publishPayload,
      { Authorization: 'Bearer admin-token' }
    )
    const result = await response.json() as { recipientCount: number }
    db.subscribers.set(`${NEWSLETTER_ID}:late@example.com`, {
      email: 'late@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
      subscribedAt: '9999-01-01T00:00:00.000Z',
    })

    const recipientMessages = await drainFirstFanoutJob(env, queueSend, queueSendBatch)

    expect(result.recipientCount).toBe(1)
    expect(recipientMessages.map((message) => message.email)).toEqual(['first@example.com'])
  })

  it('counts only unfanned subscribers when a later fanout job dead-letters', async () => {
    const { env, db, queueSend, queueSendBatch } = createEnv()
    for (let index = 0; index < 20; index += 1) {
      const email = `subscriber-${String(index).padStart(2, '0')}@example.com`
      db.subscribers.set(`${NEWSLETTER_ID}:${email}`, {
        email,
        newsletterId: NEWSLETTER_ID,
        firstName: null,
        lastName: null,
        isSubscribed: 1,
      })
    }

    const response = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      publishPayload,
      { Authorization: 'Bearer admin-token' }
    )
    const result = await response.json() as { sendId: string }
    const firstFanoutBody = queueSend.mock.calls[0][0] as Record<string, unknown>
    const firstFanout = createQueueBatch(firstFanoutBody)
    await worker.queue(firstFanout.batch, env)
    const recipientBatch = queueSendBatch.mock.calls[0][0] as Array<{ body: Record<string, unknown> }>
    for (const entry of recipientBatch.slice(0, 3)) {
      await worker.queue(createQueueBatch(entry.body).batch, env)
    }

    const nextFanoutBody = queueSend.mock.calls.at(-1)?.[0] as Record<string, unknown>
    const deadLetteredFanout = createQueueBatch(nextFanoutBody, 'letterdrop-test-dlq')
    await worker.queue(deadLetteredFanout.batch, env)

    expect(db.newsletterSends.get(result.sendId)).toEqual(expect.objectContaining({
      recipientCount: 20,
      queuedCount: 12,
      fanoutQueuedCount: 15,
      queueFailedCount: 5,
    }))
  })

  it('returns send history and paged recipient snapshots for tracked publishes', async () => {
    const { env, db, queueSend, queueSendBatch } = createEnv()
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
    await drainFirstFanoutJob(env, queueSend, queueSendBatch)

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
      'fanoutCompleted',
    ])
  })

  it('rejects unbounded recipient search input before querying recipients', async () => {
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
    db.resetOperationCount()

    const response = await app.request(
      `https://example.com/api/newsletter/${NEWSLETTER_ID}/sends/${publishResult.sendId}/recipients?q=${'x'.repeat(257)}`,
      { headers: { Authorization: 'Bearer admin-token' } },
      env
    )
    const body = await response.json() as { error: string }

    expect(response.status).toBe(400)
    expect(body.error).toBe('Recipient search must be 256 bytes or fewer')
    expect(db.operationCount).toBe(1)
  })

  it('returns bounded snapshots and paged send event history', async () => {
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
    const eventsResponse = await app.request(
      `https://example.com/api/newsletter/${NEWSLETTER_ID}/sends/${publishResult.sendId}/events?afterEventId=0&limit=500`,
      { headers: { Authorization: 'Bearer admin-token' } },
      env
    )
    const eventPage = await eventsResponse.json() as {
      events: Array<Record<string, unknown>>
      lastEventId: number
      pagination: { hasMore: boolean; nextAfterEventId: number }
    }

    expect(snapshotResponse.status).toBe(200)
    expect(snapshot.events).toHaveLength(100)
    expect(snapshot.lastEventId).toBe(505)
    expect(eventsResponse.status).toBe(200)
    expect(eventPage.events).toHaveLength(500)
    expect(eventPage.lastEventId).toBe(505)
    expect(eventPage.pagination.hasMore).toBe(true)
    expect(eventPage.pagination.nextAfterEventId).toBe(500)
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
      queuedCount: 0,
      recipientCount: 1,
      duplicate: false,
    }))
    expect(r2Put).toHaveBeenCalledTimes(4)
    expect(queueSend).toHaveBeenCalledTimes(2)
    expect(queueSend).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'fanout',
      newsletterId: SECOND_NEWSLETTER_ID,
      subject: 'Direct title: spaces & symbols',
      fileName: secondResult.fileName,
      textFileName: secondResult.textFileName,
      sendId: secondResult.sendId,
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

  it('stores the newsletter HTML and queues subscriber fanout', async () => {
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
      queuedCount: 0,
      recipientCount: 1,
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
      kind: 'fanout',
      newsletterId: NEWSLETTER_ID,
      subject: 'Bridge title: spaces & symbols',
      fileName: result.fileName,
      textFileName: result.textFileName,
      sendId: result.sendId,
    }))
  })

  it('requeues duplicate Gmail bridge messages while fanout is incomplete', async () => {
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
    expect(queueSend).toHaveBeenCalledTimes(2)
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

  it('rejects bridge publishes without sourceMessageId before queueing', async () => {
    const { env, queueSend } = createEnv()

    const response = await postJson(
      env,
      '/api/publish/google-workspace',
      {
        from: publishPayload.from,
        subject: publishPayload.subject,
        html: publishPayload.html,
        text: publishPayload.text,
      },
      { Authorization: 'Bearer bridge-token' }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'sourceMessageId is required' })
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
      kind: 'fanout',
      newsletterId: NEWSLETTER_ID,
      subject: 'Email worker title',
      fileName,
      textFileName,
      sendId: expect.any(String),
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
    const { env, db, notificationFetch, queueSend, queueSendBatch, sendStatusBrokerFetch } = createEnv()
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
    const recipientMessages = await drainFirstFanoutJob(env, queueSend, queueSendBatch)
    return {
      env,
      db,
      notificationFetch,
      sendStatusBrokerFetch,
      queueBody: recipientMessages[0],
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
      fromName: 'Haben Girma',
    })

    await worker.queue(batch, env)

    expect(message.retry).not.toHaveBeenCalled()
    expect(notificationFetch).toHaveBeenCalledTimes(1)
    const request = notificationFetch.mock.calls[0][0] as Request
    expect(request.headers.get('X-LetterDrop-Notification-Token')).toBe('notification-secret')
    const body = await getNotificationRequestBody(notificationFetch)
    expect(body.mail_to).toBe('first@example.com')
    expect(body.from_name).toBe('Haben Girma')
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
    const request = notificationFetch.mock.calls[0][0] as Request
    const expectedIdempotencyKey = `newsletter:${sendId}:${queueBody.recipientHash}`
    expect(request.headers.get('Idempotency-Key')).toBe(expectedIdempotencyKey)
    const body = await getNotificationRequestBody(notificationFetch)
    expect(body.idempotency_key).toBe(expectedIdempotencyKey)
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
    const { env, db, notificationFetch, queueSend, queueSendBatch } = createEnv({
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
    const [queueBody] = await drainFirstFanoutJob(env, queueSend, queueSendBatch)
    const { batch, message } = createQueueBatch(queueBody)

    await worker.queue(batch, env)

    expect(notificationFetch).toHaveBeenCalledTimes(1)
    expect(message.retry).not.toHaveBeenCalled()
    const recipient = Array.from(db.newsletterSendRecipients.values())[0]
    expect(recipient).toEqual(expect.objectContaining({
      status: 'needsReview',
      attempts: 1,
      lastError: expect.stringContaining('recording provider acceptance failed'),
    }))
    expect(db.newsletterSends.get(String(queueBody.sendId))).toEqual(expect.objectContaining({
      status: 'completedWithFailures',
      needsReviewCount: 1,
    }))
  })

  it('retries tracked recipients when the notification service throttles before provider acceptance', async () => {
    const { env, db, notificationFetch, queueBody, sendId } = await publishTrackedNewsletter()
    notificationFetch.mockResolvedValueOnce(new Response('sender throttled', { status: 429 }))
    const { batch, message } = createQueueBatch(queueBody)

    await worker.queue(batch, env)

    expect(message.retry).toHaveBeenCalledTimes(1)
    const recipient = Array.from(db.newsletterSendRecipients.values())[0]
    expect(recipient).toEqual(expect.objectContaining({
      status: 'retrying',
      attempts: 1,
      lastError: 'Notification service returned status 429',
    }))
    expect(db.newsletterSends.get(sendId)).toEqual(expect.objectContaining({
      status: 'sending',
      queuedCount: 0,
      retryingCount: 1,
      needsReviewCount: 0,
    }))
  })

  it('does not retry ambiguous notification failures after provider contact', async () => {
    const { env, db, notificationFetch, queueBody, sendId } = await publishTrackedNewsletter()
    notificationFetch.mockResolvedValueOnce(new Response('sender unavailable', { status: 500 }))
    const { batch, message } = createQueueBatch(queueBody)

    await worker.queue(batch, env)

    expect(message.retry).not.toHaveBeenCalled()
    const recipient = Array.from(db.newsletterSendRecipients.values())[0]
    expect(recipient).toEqual(expect.objectContaining({
      status: 'needsReview',
      attempts: 1,
      lastError: 'Notification service returned status 500',
    }))
    expect(db.newsletterSends.get(sendId)).toEqual(expect.objectContaining({
      status: 'completedWithFailures',
      needsReviewCount: 1,
    }))
  })

  it('allows later SES delivery evidence to resolve needs-review recipients', async () => {
    const { env, db, notificationFetch, queueBody, sendId } = await publishTrackedNewsletter()
    const { signEnvelope } = await createSnsSigner()
    notificationFetch.mockResolvedValueOnce(new Response('sender unavailable', { status: 500 }))
    const { batch } = createQueueBatch(queueBody)

    await worker.queue(batch, env)

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
            sendId: [sendId],
            recipientHash: [queueBody.recipientHash],
          },
        },
        delivery: {
          recipients: ['first@example.com'],
        },
      }),
    }))

    expect(response.status).toBe(200)
    const recipient = Array.from(db.newsletterSendRecipients.values())[0]
    expect(recipient.status).toBe('delivered')
    expect(db.newsletterSends.get(sendId)).toEqual(expect.objectContaining({
      status: 'completed',
      deliveredCount: 1,
      needsReviewCount: 0,
    }))
  })

  it('keeps retrying tracked recipients when delivery fails before provider contact', async () => {
    const { env, db, notificationFetch, queueBody, sendId } = await publishTrackedNewsletter()
    const { batch, message } = createQueueBatch({
      ...queueBody,
      fileName: `newsletters/${NEWSLETTER_ID}/missing.html`,
    })

    await worker.queue(batch, env)

    expect(notificationFetch).not.toHaveBeenCalled()
    expect(message.retry).toHaveBeenCalledTimes(1)
    const recipient = Array.from(db.newsletterSendRecipients.values())[0]
    expect(recipient).toEqual(expect.objectContaining({
      status: 'retrying',
      attempts: 1,
      lastError: 'Failed to get HTML content from R2',
    }))
    expect(db.newsletterSends.get(sendId)).toEqual(expect.objectContaining({
      status: 'sending',
      needsReviewCount: 0,
    }))
  })

  it('keeps retrying tracked recipients when notification preflight fails', async () => {
    const { env, db, notificationFetch, queueBody, sendId } = await publishTrackedNewsletter()
    env.NOTIFICATION_SHARED_SECRET = ''
    const { batch, message } = createQueueBatch(queueBody)

    await worker.queue(batch, env)

    expect(notificationFetch).not.toHaveBeenCalled()
    expect(message.retry).toHaveBeenCalledTimes(1)
    const recipient = Array.from(db.newsletterSendRecipients.values())[0]
    expect(recipient).toEqual(expect.objectContaining({
      status: 'retrying',
      attempts: 1,
      lastError: 'NOTIFICATION_SHARED_SECRET secret is not configured',
    }))
    expect(db.newsletterSends.get(sendId)).toEqual(expect.objectContaining({
      status: 'sending',
      needsReviewCount: 0,
    }))
  })

  it('skips duplicate queue deliveries after provider acceptance', async () => {
    const { env, db, notificationFetch, queueBody } = await publishTrackedNewsletter()
    const first = createQueueBatch(queueBody)
    const second = createQueueBatch(queueBody)

    await worker.queue(first.batch, env)
    await worker.queue(second.batch, env)

    expect(notificationFetch).toHaveBeenCalledTimes(1)
    expect(second.message.retry).not.toHaveBeenCalled()
    const recipient = Array.from(db.newsletterSendRecipients.values())[0]
    expect(recipient).toEqual(expect.objectContaining({
      status: 'providerAccepted',
      attempts: 1,
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
    const { env, db, queueSend, queueSendBatch } = createEnv()
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
    const [queueBody] = await drainFirstFanoutJob(env, queueSend, queueSendBatch)

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
    const { env, db, queueSend, queueSendBatch } = createEnv()
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
    const [queueBody] = await drainFirstFanoutJob(env, queueSend, queueSendBatch)
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
    const { env, db, queueSend, queueSendBatch } = createEnv()
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
    const [queueBody] = await drainFirstFanoutJob(env, queueSend, queueSendBatch)

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
