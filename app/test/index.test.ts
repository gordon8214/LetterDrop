import { beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { app } from '../src/index'

const NEWSLETTER_ID = '11111111-1111-4111-8111-111111111111'
const MISSING_NEWSLETTER_ID = '22222222-2222-4222-8222-222222222222'
const SECOND_NEWSLETTER_ID = '33333333-3333-4333-8333-333333333333'
const SUBSCRIBER_EMAIL = 'user@example.com'
const UNSUBSCRIBE_PLACEHOLDER_URL = 'https://unsubscribe.letterdrop.invalid/'
const TRACKED_PUBLISH_PAYLOAD = {
  subject: 'Tracked title',
  html: '<p>Hello tracked subscribers</p>',
  text: 'Hello tracked subscribers',
  sourceMessageId: 'tracked-source-message',
}

function factoryEmailTextStyle(fontSizePx: number, fontWeight: number) {
  return {
    fontFamily: 'helvetica',
    fontSizePx,
    fontWeight,
    fontStyle: 'normal',
    lineHeight: 1.2,
    letterSpacingPx: 0,
    alignment: 'left',
  }
}

function factoryEmailStyleConfig() {
  return {
    version: 1,
    layout: {
      maxWidthPx: null as number | null,
      outerPaddingHorizontalPx: 8,
      outerPaddingVerticalPx: 8,
      contentPaddingHorizontalPx: 0,
      contentPaddingVerticalPx: 0,
    },
    body: {
      ...factoryEmailTextStyle(14, 400),
      paragraphMarginTopPx: 14,
      paragraphMarginBottomPx: 14,
    },
    headings: {
      h1: { ...factoryEmailTextStyle(28, 700), marginTopPx: 18.76, marginBottomPx: 18.76 },
      h2: { ...factoryEmailTextStyle(25, 700), marginTopPx: 20.75, marginBottomPx: 20.75 },
      h3: { ...factoryEmailTextStyle(21, 700), marginTopPx: 21, marginBottomPx: 21 },
      h4: { ...factoryEmailTextStyle(18, 700), marginTopPx: 23.94, marginBottomPx: 23.94 },
      h5: { ...factoryEmailTextStyle(16, 700), marginTopPx: 26.72, marginBottomPx: 26.72 },
    },
    lists: {
      indentationPx: 40,
      marginTopPx: 14,
      marginBottomPx: 14,
      itemSpacingPx: 0,
    },
    links: { underline: true },
    linkPreviews: {
      fontFamily: 'system-ui',
      titleFontSizePx: 20,
      hostFontSizePx: 16,
      titleURLSpacingPx: 8,
    },
  }
}

type NewsletterRecord = {
  id: string
  subscribable: number
  title?: string
  description?: string
  logo?: string | null
  createdAt?: string
  updatedAt?: string
  deletedAt?: string | null
}

type SubscriberRecord = {
  email: string
  newsletterId: string
  firstName: string | null
  lastName: string | null
  notes?: string | null
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
  failQueueSendCount?: number
  failR2DeleteOnce?: boolean
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
  footerHtml: string | null
  footerText: string | null
  scheduledAt?: string | null
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

type NewsletterDraftRecord = {
  id: string
  newsletterId: string
  subject: string
  sourceMessageId: string
  contentFileName: string
  textFileName: string
  status: 'draft' | 'scheduled' | 'dispatching' | 'sent'
  sendId: string | null
  scheduledAt: string | null
  scheduleNextAttemptAt: string | null
  scheduleClaimedAt: string | null
  scheduleLastAttemptAt: string | null
  scheduleAttemptCount: number
  scheduleLastError: string | null
  scheduledContentFileName: string | null
  scheduledTextFileName: string | null
  scheduledFromName: string | null
  scheduledFooterHtml: string | null
  scheduledFooterText: string | null
  scheduledEmailStyleConfig: string | null
  createdAt: string
  updatedAt: string
  sentAt: string | null
  deletedAt?: string | null
}

type TrashPurgeJobRecord = {
  kind: 'newsletter' | 'draft'
  newsletterId: string
  itemId: string
  contentFileName: string | null
  textFileName: string | null
  createdAt: string
}

class FakeKVNamespace {
  readonly store = new Map<string, string>()
  readonly ttls = new Map<string, number | undefined>()

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, value)
    this.ttls.set(key, options?.expirationTtl)
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
    this.ttls.delete(key)
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
  readonly newsletterDrafts = new Map<string, NewsletterDraftRecord>()
  readonly trashPurgeJobs = new Map<string, TrashPurgeJobRecord>()
  readonly attemptedRateLimitBuckets: string[] = []
  operationCount = 0

  private readonly denyBuckets: Set<string>
  private readonly missingAbuseEventTable: boolean
  private readonly failRecipientStatusUpdates: Set<string>
  private failFanoutAdvanceOnce: boolean
  private sourceMessageLookupMisses = 0
  private nextNewsletterSendEventId = 1
  private beforeBatchHook: (() => void) | null = null
  private beforeScheduleWriteHook: (() => void) | null = null

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

  beforeNextBatch(hook: () => void) {
    this.beforeBatchHook = hook
  }

  beforeNextScheduleWrite(hook: () => void) {
    this.beforeScheduleWriteHook = hook
  }

  private runBeforeScheduleWriteHook() {
    const hook = this.beforeScheduleWriteHook
    this.beforeScheduleWriteHook = null
    hook?.()
  }

  private subscriberEntry(
    newsletterId: string,
    email: string
  ): [string, SubscriberRecord] | null {
    const exactKey = `${newsletterId}:${email}`
    const exact = this.subscribers.get(exactKey)
    if (exact) {
      return [exactKey, exact]
    }

    const normalizedEmail = email.toLowerCase()
    for (const [key, subscriber] of this.subscribers.entries()) {
      if (
        subscriber.newsletterId === newsletterId &&
        subscriber.email.toLowerCase() === normalizedEmail
      ) {
        return [key, subscriber]
      }
    }
    return null
  }

  private newsletterPurgeJobIds(newsletterId?: string) {
    return new Set(
      Array.from(this.trashPurgeJobs.values())
        .filter((job) => (
          job.kind === 'newsletter' &&
          Boolean(this.newsletters.get(job.newsletterId)?.deletedAt) &&
          (!newsletterId || job.newsletterId === newsletterId)
        ))
        .map((job) => job.newsletterId)
    )
  }

  async batch(statements: Array<FakeD1PreparedStatement>) {
    const hook = this.beforeBatchHook
    this.beforeBatchHook = null
    hook?.()

    const results = []
    for (const statement of statements) {
      results.push(await statement.run())
    }
    return results
  }

  async first<T>(sql: string, params: unknown[]): Promise<T | null> {
    this.operationCount += 1
    const normalized = normalizeSql(sql)
    if (normalized.includes('select id, subscribable from newsletter where id = ?')) {
      const newsletterId = String(params[0] ?? '')
      const newsletter = this.newsletters.get(newsletterId)
      if (!newsletter || (normalized.includes('deletedat is null') && newsletter.deletedAt)) {
        return null
      }
      return newsletter as T
    }

    if (normalized.includes('select id from newsletter where id = ?')) {
      const newsletterId = String(params[0] ?? '')
      const newsletter = this.newsletters.get(newsletterId)
      if (!newsletter || (normalized.includes('deletedat is null') && newsletter.deletedAt)) {
        return null
      }
      if (normalized.includes('deletedat is not null') && !newsletter.deletedAt) {
        return null
      }
      return ({ id: newsletter.id } as T)
    }

    if (
      normalized.includes('from trashpurgejob') &&
      normalized.includes('where kind = ? and newsletter_id = ? and item_id = ?')
    ) {
      const kind = String(params[0] ?? '')
      const newsletterId = String(params[1] ?? '')
      const itemId = String(params[2] ?? '')
      return (this.trashPurgeJobs.get(`${kind}:${newsletterId}:${itemId}`) ?? null) as T | null
    }

    if (normalized.startsWith('select (select count(*) from newsletter where deletedat is not null)')) {
      const newsletters = Array.from(this.newsletters.values())
        .filter((newsletter) => Boolean(newsletter.deletedAt)).length
      const subscribers = Array.from(this.subscribers.values())
        .filter((subscriber) => (
          Boolean(subscriber.deletedAt) &&
          !this.newsletters.get(subscriber.newsletterId)?.deletedAt
        )).length
      const drafts = Array.from(this.newsletterDrafts.values())
        .filter((draft) => (
          Boolean(draft.deletedAt) &&
          !this.newsletters.get(draft.newsletterId)?.deletedAt
        )).length
      if (normalized.includes(' as newsletters,')) {
        return ({ newsletters, subscribers, drafts } as T)
      }
      return ({ total: newsletters + subscribers + drafts } as T)
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

    if (normalized.includes('select count(*) as total from subscriber')) {
      const newsletterId = String(params[0] ?? '')
      const total = Array.from(this.subscribers.values())
        .filter((subscriber) => (
          subscriber.newsletterId === newsletterId &&
          (subscriber.deletedAt === undefined || subscriber.deletedAt === null)
        )).length
      return ({ total } as T)
    }

    if (
      normalized.includes('select email from subscriber') &&
      normalized.includes('email = ? collate nocase') &&
      normalized.includes('newsletter_id = ?')
    ) {
      const email = String(params[0] ?? '')
      const newsletterId = String(params[1] ?? '')
      const subscriber = this.subscriberEntry(newsletterId, email)?.[1]
      if (!subscriber) {
        return null
      }
      if (normalized.includes('deleted_at is null') && subscriber.deletedAt) {
        return null
      }
      return ({ email: subscriber.email } as T)
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

    if (
      normalized.includes('select d.content_file_name as contentfilename') &&
      normalized.includes('where d.id = ? and d.newsletter_id = ?')
    ) {
      const draftId = String(params[0] ?? '')
      const newsletterId = String(params[1] ?? '')
      const draft = this.newsletterDrafts.get(draftId)
      const newsletter = this.newsletters.get(newsletterId)
      if (
        !draft || draft.newsletterId !== newsletterId || !draft.deletedAt ||
        !newsletter || newsletter.deletedAt
      ) {
        return null
      }
      return ({
        contentFileName: draft.contentFileName,
        textFileName: draft.textFileName,
      } as T)
    }

    if (
      normalized.includes('select id from newsletterdraft') &&
      normalized.includes("status in ('scheduled', 'dispatching')")
    ) {
      const newsletterId = String(params[0] ?? '')
      const draft = Array.from(this.newsletterDrafts.values()).find((candidate) => (
        candidate.newsletterId === newsletterId &&
        (candidate.status === 'scheduled' || candidate.status === 'dispatching') &&
        !candidate.deletedAt
      ))
      return (draft ? { id: draft.id } : null) as T | null
    }

    if (
      normalized.includes('from newsletterdraft') &&
      (normalized.includes('where id = ?') || normalized.includes('where d.id = ?'))
    ) {
      const draftId = String(params[0] ?? '')
      const draft = this.newsletterDrafts.get(draftId)
      if (
        !draft ||
        (normalized.includes('d.deletedat is null') && draft.deletedAt) ||
        (
          normalized.includes('n.deletedat is null') &&
          this.newsletters.get(draft.newsletterId)?.deletedAt
        )
      ) {
        return null
      }
      return draft as T
    }

    if (
      normalized.includes('from newsletterdraft') &&
      (
        normalized.includes('where newsletter_id = ? and source_message_id = ?') ||
        normalized.includes('where d.newsletter_id = ? and d.source_message_id = ?')
      )
    ) {
      const newsletterId = String(params[0] ?? '')
      const sourceMessageId = String(params[1] ?? '')
      const draft = Array.from(this.newsletterDrafts.values()).find((candidate) => (
        candidate.newsletterId === newsletterId &&
        candidate.sourceMessageId === sourceMessageId &&
        (!normalized.includes('d.deletedat is null') || !candidate.deletedAt) &&
        (!normalized.includes('n.deletedat is null') || !this.newsletters.get(candidate.newsletterId)?.deletedAt)
      )) ?? null
      return draft as T | null
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

    if (normalized.includes("select kind, id, newsletterid, title, subtitle, deletedat from (")) {
      const limit = Number(params[0] ?? Number.MAX_SAFE_INTEGER)
      const offset = Number(params[1] ?? 0)
      const items = [
        ...Array.from(this.newsletters.values())
          .filter((newsletter) => Boolean(newsletter.deletedAt))
          .map((newsletter) => ({
            kind: 'newsletter',
            id: newsletter.id,
            newsletterId: newsletter.id,
            title: newsletter.title ?? '',
            subtitle: 'Newsletter',
            deletedAt: newsletter.deletedAt,
          })),
        ...Array.from(this.subscribers.values())
          .filter((subscriber) => (
            Boolean(subscriber.deletedAt) &&
            !this.newsletters.get(subscriber.newsletterId)?.deletedAt
          ))
          .map((subscriber) => {
            const name = [subscriber.firstName, subscriber.lastName].filter(Boolean).join(' ')
            const newsletterTitle = this.newsletters.get(subscriber.newsletterId)?.title ?? ''
            return {
              kind: 'subscriber',
              id: subscriber.email,
              newsletterId: subscriber.newsletterId,
              title: name || subscriber.email,
              subtitle: name
                ? `${subscriber.email} • Subscriber in “${newsletterTitle}”`
                : `Subscriber in “${newsletterTitle}”`,
              deletedAt: subscriber.deletedAt,
            }
          }),
        ...Array.from(this.newsletterDrafts.values())
          .filter((draft) => (
            Boolean(draft.deletedAt) &&
            !this.newsletters.get(draft.newsletterId)?.deletedAt
          ))
          .map((draft) => ({
            kind: 'draft',
            id: draft.id,
            newsletterId: draft.newsletterId,
            title: draft.subject.trim() || 'Untitled Draft',
            subtitle: `Draft in “${this.newsletters.get(draft.newsletterId)?.title ?? ''}”`,
            deletedAt: draft.deletedAt,
          })),
      ].sort((first, second) => (
        String(second.deletedAt).localeCompare(String(first.deletedAt)) ||
        first.kind.localeCompare(second.kind) ||
        first.id.localeCompare(second.id)
      )).slice(offset, offset + limit)
      return { results: items as T[] }
    }

    if (
      normalized.includes('from trashpurgejob') &&
      normalized.includes('order by createdat, kind, newsletter_id, item_id')
    ) {
      const jobs = Array.from(this.trashPurgeJobs.values()).sort((first, second) => (
        first.createdAt.localeCompare(second.createdAt) ||
        first.kind.localeCompare(second.kind) ||
        first.newsletterId.localeCompare(second.newsletterId) ||
        first.itemId.localeCompare(second.itemId)
      ))
      return { results: jobs as T[] }
    }

    if (normalized === 'select id from newsletter where deletedat is not null') {
      const newsletters = Array.from(this.newsletters.values())
        .filter((newsletter) => Boolean(newsletter.deletedAt))
        .map((newsletter) => ({ id: newsletter.id }))
      return { results: newsletters as T[] }
    }

    if (
      normalized.includes('select d.content_file_name as contentfilename') &&
      normalized.includes('where d.deletedat is not null and n.deletedat is null')
    ) {
      const drafts = Array.from(this.newsletterDrafts.values())
        .filter((draft) => (
          Boolean(draft.deletedAt) &&
          !this.newsletters.get(draft.newsletterId)?.deletedAt
        ))
        .map((draft) => ({
          contentFileName: draft.contentFileName,
          textFileName: draft.textFileName,
        }))
      return { results: drafts as T[] }
    }

    if (normalized.includes('select * from subscriber')) {
      const newsletterId = String(params[0] ?? '')
      const limit = Number(params[1] ?? Number.MAX_SAFE_INTEGER)
      const offset = Number(params[2] ?? 0)
      const subscribers = Array.from(this.subscribers.values())
        .filter((subscriber) => (
          subscriber.newsletterId === newsletterId &&
          (subscriber.deletedAt === undefined || subscriber.deletedAt === null)
        ))
        .sort((first, second) => (
          (second.upsertedAt ?? '').localeCompare(first.upsertedAt ?? '')
        ))
        .slice(offset, offset + limit)
        .map((subscriber) => ({
          email: subscriber.email,
          first_name: subscriber.firstName,
          last_name: subscriber.lastName,
          notes: subscriber.notes ?? null,
          newsletter_id: subscriber.newsletterId,
          isSubscribed: subscriber.isSubscribed,
          upsertedAt: subscriber.upsertedAt ?? null,
          subscribed_at: subscriber.subscribedAt ?? null,
          unsubscribed_at: subscriber.unsubscribedAt ?? null,
          deleted_at: subscriber.deletedAt ?? null,
        }))
      return { results: subscribers as T[] }
    }

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

    if (
      normalized.includes('select d.id from newsletterdraft d') &&
      normalized.includes("d.status = 'scheduled'")
    ) {
      const now = String(params[0] ?? '')
      const limit = Number(params[1] ?? 100)
      const drafts = Array.from(this.newsletterDrafts.values())
        .filter((draft) => (
          draft.status === 'scheduled' &&
          !draft.deletedAt &&
          !this.newsletters.get(draft.newsletterId)?.deletedAt &&
          draft.scheduleNextAttemptAt !== null &&
          draft.scheduleNextAttemptAt <= now
        ))
        .sort((first, second) => (
          String(first.scheduleNextAttemptAt)
            .localeCompare(String(second.scheduleNextAttemptAt)) ||
          first.createdAt.localeCompare(second.createdAt)
        ))
        .slice(0, limit)
        .map((draft) => ({ id: draft.id }))
      return { results: drafts as T[] }
    }

    if (
      normalized.includes('from newsletterdraft') &&
      normalized.includes("status in ('scheduled', 'dispatching')")
    ) {
      const newsletterId = String(params[0] ?? '')
      const drafts = Array.from(this.newsletterDrafts.values())
        .filter((draft) => (
          draft.newsletterId === newsletterId &&
          (draft.status === 'scheduled' || draft.status === 'dispatching') &&
          !draft.deletedAt
        ))
        .sort((first, second) => (
          String(first.scheduledAt).localeCompare(String(second.scheduledAt)) ||
          first.createdAt.localeCompare(second.createdAt)
        ))
      return { results: drafts as T[] }
    }

    if (normalized.includes('from newsletterdraft') && normalized.includes("where newsletter_id = ? and status = 'draft'")) {
      const newsletterId = String(params[0] ?? '')
      const drafts = Array.from(this.newsletterDrafts.values())
        .filter((draft) => (
          draft.newsletterId === newsletterId &&
          draft.status === 'draft' &&
          (!normalized.includes('deletedat is null') || !draft.deletedAt)
        ))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 50)
      return { results: drafts as T[] }
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

    if (normalized.includes('update newsletter set deletedat = null')) {
      const newsletterId = String(params[0] ?? '')
      const newsletter = this.newsletters.get(newsletterId)
      if (!newsletter?.deletedAt) {
        return { meta: { changes: 0 } }
      }
      newsletter.deletedAt = null
      return { meta: { changes: 1 } }
    }

    if (normalized.includes('update newsletter set deletedat = ?')) {
      const deletedAt = String(params[0] ?? '')
      const newsletterId = String(params[1] ?? '')
      const newsletter = this.newsletters.get(newsletterId)
      const hasActiveSchedule = Array.from(this.newsletterDrafts.values()).some((draft) => (
        draft.newsletterId === newsletterId &&
        (draft.status === 'scheduled' || draft.status === 'dispatching') &&
        !draft.deletedAt
      ))
      if (
        !newsletter || newsletter.deletedAt ||
        (normalized.includes('not exists') && hasActiveSchedule)
      ) {
        return { meta: { changes: 0 } }
      }
      newsletter.deletedAt = deletedAt
      return { meta: { changes: 1 } }
    }

    if (normalized.includes('update newsletter set subscribable = ?')) {
      const subscribable = Number(params[0] ?? 0)
      const newsletterId = String(params[1] ?? '')
      const newsletter = this.newsletters.get(newsletterId)
      if (!newsletter || newsletter.deletedAt) {
        return { meta: { changes: 0 } }
      }
      newsletter.subscribable = subscribable
      return { meta: { changes: 1 } }
    }

    if (normalized.includes('insert or ignore into trashpurgejob')) {
      const createdAt = String(params[0] ?? '')
      const candidates: TrashPurgeJobRecord[] = normalized.includes("select 'newsletter'")
        ? Array.from(this.newsletters.values())
          .filter((newsletter) => (
            Boolean(newsletter.deletedAt) &&
            (params.length === 1 || newsletter.id === String(params[1] ?? ''))
          ))
          .map((newsletter) => ({
            kind: 'newsletter',
            newsletterId: newsletter.id,
            itemId: newsletter.id,
            contentFileName: null,
            textFileName: null,
            createdAt,
          }))
        : Array.from(this.newsletterDrafts.values())
          .filter((draft) => (
            Boolean(draft.deletedAt) &&
            !this.newsletters.get(draft.newsletterId)?.deletedAt &&
            (
              params.length === 1 ||
              (draft.id === String(params[1] ?? '') && draft.newsletterId === String(params[2] ?? ''))
            )
          ))
          .map((draft) => ({
            kind: 'draft',
            newsletterId: draft.newsletterId,
            itemId: draft.id,
            contentFileName: draft.contentFileName,
            textFileName: draft.textFileName,
            createdAt,
          }))

      let changes = 0
      for (const job of candidates) {
        const key = `${job.kind}:${job.newsletterId}:${job.itemId}`
        if (!this.trashPurgeJobs.has(key)) {
          this.trashPurgeJobs.set(key, job)
          changes += 1
        }
      }
      return { meta: { changes } }
    }

    if (normalized.includes('update newsletterdraft set deletedat = null')) {
      const draftId = String(params[0] ?? '')
      const newsletterId = String(params[1] ?? '')
      const draft = this.newsletterDrafts.get(draftId)
      const newsletter = this.newsletters.get(newsletterId)
      if (
        !draft?.deletedAt || draft.newsletterId !== newsletterId ||
        !newsletter || newsletter.deletedAt
      ) {
        return { meta: { changes: 0 } }
      }
      const sourceConflict = Array.from(this.newsletterDrafts.values()).some((candidate) => (
        candidate.id !== draft.id &&
        candidate.newsletterId === newsletterId &&
        candidate.sourceMessageId === draft.sourceMessageId &&
        !candidate.deletedAt
      ))
      if (sourceConflict) {
        throw new Error(
          'D1_ERROR: UNIQUE constraint failed: NewsletterDraft.newsletter_id, NewsletterDraft.source_message_id'
        )
      }
      draft.deletedAt = null
      return { meta: { changes: 1 } }
    }

    if (normalized.includes('update newsletterdraft set deletedat = ?')) {
      const deletedAt = String(params[0] ?? '')
      const draftId = String(params[1] ?? '')
      const newsletterId = String(params[2] ?? '')
      const draft = this.newsletterDrafts.get(draftId)
      if (
        !draft || draft.newsletterId !== newsletterId ||
        draft.status !== 'draft' || draft.deletedAt
      ) {
        return { meta: { changes: 0 } }
      }
      draft.deletedAt = deletedAt
      return { meta: { changes: 1 } }
    }

    if (normalized.includes('update subscriber set deleted_at = null')) {
      const email = String(params[0] ?? '')
      const newsletterId = String(params[1] ?? '')
      const subscriber = this.subscriberEntry(newsletterId, email)?.[1]
      const newsletter = this.newsletters.get(newsletterId)
      if (!subscriber?.deletedAt || !newsletter || newsletter.deletedAt) {
        return { meta: { changes: 0 } }
      }
      subscriber.deletedAt = null
      return { meta: { changes: 1 } }
    }

    if (normalized.includes('insert into subscriber')) {
      const hasNotesColumn = normalized.includes(
        'email, first_name, last_name, notes, newsletter_id'
      )
      const email = String(params[0] ?? '')
      const firstName = normalizeNameParam(params[1])
      const lastName = normalizeNameParam(params[2])
      const notes = hasNotesColumn ? normalizeNameParam(params[3]) : null
      const newsletterIndex = hasNotesColumn ? 4 : 3
      const upsertedAtIndex = newsletterIndex + 1
      const subscribedAtIndex = upsertedAtIndex + 1
      const newsletterId = String(params[newsletterIndex] ?? '')
      const upsertedAt = String(params[upsertedAtIndex] ?? new Date().toISOString())
      const subscribedAt = String(params[subscribedAtIndex] ?? upsertedAt)
      const shouldUpdateNotes = hasNotesColumn && Number(params[subscribedAtIndex + 1] ?? 0) === 1
      const key = `${newsletterId}:${email}`
      const existingEntry = this.subscriberEntry(newsletterId, email)
      const existingKey = existingEntry?.[0] ?? key
      const existing = existingEntry?.[1]
      const guardsUnsubscribed = normalized.includes(
        'where subscriber.issubscribed = 1 or ? = 1'
      )
      const resubscribeUnsubscribed = Number(params[subscribedAtIndex + 2] ?? 0) === 1
      if (guardsUnsubscribed && existing?.isSubscribed === 0 && !resubscribeUnsubscribed) {
        return { meta: { changes: 0 } }
      }
      this.subscribers.set(existingKey, {
        email: existing?.email ?? email,
        newsletterId,
        firstName: firstName ?? existing?.firstName ?? null,
        lastName: lastName ?? existing?.lastName ?? null,
        notes: existing
          ? (shouldUpdateNotes ? notes : existing.notes ?? null)
          : notes,
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

    if (normalized.includes('update subscriber set email = ?')) {
      const email = String(params[0] ?? '')
      const firstName = normalizeNameParam(params[1])
      const lastName = normalizeNameParam(params[2])
      const notes = normalizeNameParam(params[3])
      const requestedSubscriptionState = params[4] === null
        ? null
        : Number(params[4])
      const upsertedAt = String(params[5] ?? new Date().toISOString())
      const originalEmail = String(params[params.length - 2] ?? '')
      const newsletterId = String(params[params.length - 1] ?? '')
      const originalEntry = this.subscriberEntry(newsletterId, originalEmail)
      const originalKey = originalEntry?.[0] ?? `${newsletterId}:${originalEmail}`
      const updatedKey = `${newsletterId}:${email}`
      const existing = originalEntry?.[1]
      if (!existing || existing.deletedAt) {
        return { meta: { changes: 0 } }
      }
      const conflictEntry = this.subscriberEntry(newsletterId, email)
      if (conflictEntry && conflictEntry[0] !== originalKey) {
        throw new Error('UNIQUE constraint failed: Subscriber.email, Subscriber.newsletter_id')
      }

      this.subscribers.delete(originalKey)
      const isSubscribed = requestedSubscriptionState ?? existing.isSubscribed
      this.subscribers.set(updatedKey, {
        ...existing,
        email,
        firstName,
        lastName,
        notes,
        isSubscribed,
        upsertedAt,
        subscribedAt: requestedSubscriptionState === 1
          ? (existing.isSubscribed === 1 ? existing.subscribedAt ?? upsertedAt : upsertedAt)
          : existing.subscribedAt,
        unsubscribedAt: requestedSubscriptionState === 1
          ? null
          : requestedSubscriptionState === 0
            ? (existing.isSubscribed === 1
                ? upsertedAt
                : existing.unsubscribedAt ?? upsertedAt)
            : existing.unsubscribedAt,
        deletedAt: requestedSubscriptionState === 1 ? null : existing.deletedAt,
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
      const existingEntry = this.subscriberEntry(newsletterId, email)
      if (!existingEntry) {
        return { meta: { changes: 0 } }
      }
      const [key, existing] = existingEntry
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

    if (normalized.includes('insert into newsletterdraft')) {
      const newsletterId = String(params[1] ?? '')
      const sourceMessageId = String(params[3] ?? '')
      if (
        Array.from(this.newsletterDrafts.values()).some((draft) => (
          draft.newsletterId === newsletterId &&
          draft.sourceMessageId === sourceMessageId &&
          !draft.deletedAt
        ))
      ) {
        throw new Error(
          'D1_ERROR: UNIQUE constraint failed: NewsletterDraft.newsletter_id, NewsletterDraft.source_message_id'
        )
      }

      const draft: NewsletterDraftRecord = {
        id: String(params[0] ?? ''),
        newsletterId,
        subject: String(params[2] ?? ''),
        sourceMessageId,
        contentFileName: String(params[4] ?? ''),
        textFileName: String(params[5] ?? ''),
        status: 'draft',
        sendId: null,
        scheduledAt: null,
        scheduleNextAttemptAt: null,
        scheduleClaimedAt: null,
        scheduleLastAttemptAt: null,
        scheduleAttemptCount: 0,
        scheduleLastError: null,
        scheduledContentFileName: null,
        scheduledTextFileName: null,
        scheduledFromName: null,
        scheduledFooterHtml: null,
        scheduledFooterText: null,
        scheduledEmailStyleConfig: null,
        createdAt: String(params[6] ?? ''),
        updatedAt: String(params[7] ?? ''),
        sentAt: null,
        deletedAt: null,
      }
      this.newsletterDrafts.set(draft.id, draft)
      return { meta: { changes: 1 } }
    }

    if (
      normalized.includes('update newsletterdraft') &&
      normalized.includes('set subject = ?') &&
      normalized.includes("status = 'scheduled'") &&
      normalized.includes('scheduled_at = ?')
    ) {
      this.runBeforeScheduleWriteHook()
      const draftId = String(params[12] ?? '')
      const expectedStatus = String(params[13] ?? '')
      const expectedContentFileName = String(params[14] ?? '')
      const expectedTextFileName = String(params[15] ?? '')
      const draft = this.newsletterDrafts.get(draftId)
      const newsletter = draft ? this.newsletters.get(draft.newsletterId) : null
      if (
        !draft || draft.status !== expectedStatus || draft.deletedAt ||
        draft.contentFileName !== expectedContentFileName ||
        draft.textFileName !== expectedTextFileName ||
        (normalized.includes('n.deletedat is null') && (!newsletter || newsletter.deletedAt))
      ) {
        return { meta: { changes: 0 } }
      }
      const wasDraft = draft.status === 'draft'
      draft.subject = String(params[0] ?? '')
      draft.contentFileName = String(params[1] ?? '')
      draft.textFileName = String(params[2] ?? '')
      draft.status = 'scheduled'
      draft.scheduledAt = String(params[3] ?? '')
      draft.scheduleNextAttemptAt = String(params[4] ?? '')
      draft.scheduleClaimedAt = null
      draft.scheduleLastAttemptAt = null
      draft.scheduleAttemptCount = wasDraft ? 0 : draft.scheduleAttemptCount
      draft.scheduleLastError = null
      draft.scheduledContentFileName = String(params[5] ?? '')
      draft.scheduledTextFileName = String(params[6] ?? '')
      draft.scheduledFromName = params[7] === null ? null : String(params[7] ?? '')
      draft.scheduledFooterHtml = String(params[8] ?? '')
      draft.scheduledFooterText = String(params[9] ?? '')
      draft.scheduledEmailStyleConfig = String(params[10] ?? '')
      draft.updatedAt = String(params[11] ?? '')
      return { meta: { changes: 1 } }
    }

    if (
      normalized.includes('update newsletterdraft') &&
      normalized.includes('scheduled_content_file_name = ?') &&
      normalized.includes("where id = ? and status = 'scheduled'")
    ) {
      this.runBeforeScheduleWriteHook()
      const draftId = String(params[6] ?? '')
      const expectedContentFileName = String(params[7] ?? '')
      const expectedTextFileName = String(params[8] ?? '')
      const draft = this.newsletterDrafts.get(draftId)
      if (
        !draft || draft.status !== 'scheduled' || draft.deletedAt ||
        draft.contentFileName !== expectedContentFileName ||
        draft.textFileName !== expectedTextFileName
      ) {
        return { meta: { changes: 0 } }
      }
      draft.subject = String(params[0] ?? '')
      draft.contentFileName = String(params[1] ?? '')
      draft.textFileName = String(params[2] ?? '')
      draft.scheduledContentFileName = String(params[3] ?? '')
      draft.scheduledTextFileName = String(params[4] ?? '')
      draft.scheduleNextAttemptAt = draft.scheduledAt
      draft.scheduleClaimedAt = null
      draft.scheduleLastError = null
      draft.updatedAt = String(params[5] ?? '')
      return { meta: { changes: 1 } }
    }

    if (
      normalized.includes('update newsletterdraft') &&
      normalized.includes("set status = 'draft', scheduled_at = null")
    ) {
      const draftId = String(params[1] ?? '')
      const draft = this.newsletterDrafts.get(draftId)
      if (!draft || draft.status !== 'scheduled' || draft.deletedAt) {
        return { meta: { changes: 0 } }
      }
      draft.status = 'draft'
      draft.scheduledAt = null
      draft.scheduleNextAttemptAt = null
      draft.scheduleClaimedAt = null
      draft.scheduleLastAttemptAt = null
      draft.scheduleAttemptCount = 0
      draft.scheduleLastError = null
      draft.scheduledContentFileName = null
      draft.scheduledTextFileName = null
      draft.scheduledFromName = null
      draft.scheduledFooterHtml = null
      draft.scheduledFooterText = null
      draft.scheduledEmailStyleConfig = null
      draft.updatedAt = String(params[0] ?? '')
      return { meta: { changes: 1 } }
    }

    if (
      normalized.includes('update newsletterdraft') &&
      normalized.includes("set status = 'dispatching'")
    ) {
      const draftId = String(params[3] ?? '')
      const dueAt = params.length > 4 ? String(params[4] ?? '') : null
      const draft = this.newsletterDrafts.get(draftId)
      const nextAttemptAt = draft?.scheduleNextAttemptAt ?? draft?.scheduledAt ?? ''
      if (
        !draft || draft.status !== 'scheduled' || draft.deletedAt ||
        (dueAt !== null && String(nextAttemptAt) > dueAt)
      ) {
        return { meta: { changes: 0 } }
      }
      draft.status = 'dispatching'
      draft.scheduleClaimedAt = String(params[0] ?? '')
      draft.scheduleLastAttemptAt = String(params[1] ?? '')
      draft.scheduleAttemptCount += 1
      draft.updatedAt = String(params[2] ?? '')
      return { meta: { changes: 1 } }
    }

    if (
      normalized.includes('update newsletterdraft') &&
      normalized.includes("set status = 'scheduled'") &&
      normalized.includes('where status = \'dispatching\'') &&
      normalized.includes('schedule_claimed_at <= ?')
    ) {
      const nextAttemptAt = String(params[0] ?? '')
      const updatedAt = String(params[1] ?? '')
      const staleBefore = String(params[2] ?? '')
      let changes = 0
      for (const draft of this.newsletterDrafts.values()) {
        if (
          draft.status === 'dispatching' && !draft.deletedAt &&
          String(draft.scheduleClaimedAt ?? '') <= staleBefore
        ) {
          draft.status = 'scheduled'
          draft.scheduleNextAttemptAt = nextAttemptAt
          draft.scheduleClaimedAt = null
          draft.scheduleLastError = 'Recovered a stale dispatch claim.'
          draft.updatedAt = updatedAt
          changes += 1
        }
      }
      return { meta: { changes } }
    }

    if (
      normalized.includes('update newsletterdraft') &&
      normalized.includes("set status = 'scheduled'") &&
      normalized.includes("where id = ? and status = 'dispatching'")
    ) {
      const draftId = String(params[3] ?? '')
      const claimedAt = String(params[4] ?? '')
      const draft = this.newsletterDrafts.get(draftId)
      if (
        !draft || draft.status !== 'dispatching' ||
        draft.scheduleClaimedAt !== claimedAt
      ) {
        return { meta: { changes: 0 } }
      }
      draft.status = 'scheduled'
      draft.scheduleNextAttemptAt = String(params[0] ?? '')
      draft.scheduleClaimedAt = null
      draft.scheduleLastError = String(params[1] ?? '')
      draft.updatedAt = String(params[2] ?? '')
      return { meta: { changes: 1 } }
    }

    if (
      normalized.includes('update newsletterdraft') &&
      normalized.includes('set scheduled_at = ?') &&
      normalized.includes("where id = ? and status = 'scheduled'")
    ) {
      const draftId = String(params[3] ?? '')
      const draft = this.newsletterDrafts.get(draftId)
      if (!draft || draft.status !== 'scheduled' || draft.deletedAt) {
        return { meta: { changes: 0 } }
      }
      draft.scheduledAt = String(params[0] ?? '')
      draft.scheduleNextAttemptAt = String(params[1] ?? '')
      draft.scheduleClaimedAt = null
      draft.scheduleLastError = null
      draft.updatedAt = String(params[2] ?? '')
      return { meta: { changes: 1 } }
    }

    if (normalized.includes('update newsletterdraft') && normalized.includes("set status = 'sent'")) {
      const sendId = params[0] === null ? null : String(params[0] ?? '')
      const sentAt = String(params[1] ?? '')
      const updatedAt = String(params[2] ?? '')
      const draftId = String(params[3] ?? '')
      const expectedStatus = String(params[4] ?? 'draft')
      const draft = this.newsletterDrafts.get(draftId)
      if (draft && draft.status === expectedStatus) {
        draft.status = 'sent'
        draft.sendId = sendId
        draft.sentAt = sentAt
        draft.scheduleNextAttemptAt = null
        draft.scheduleClaimedAt = null
        draft.scheduleLastError = null
        draft.updatedAt = updatedAt
        return { meta: { changes: 1 } }
      }
      return { meta: { changes: 0 } }
    }

    if (normalized.includes('update newsletterdraft')) {
      const subject = String(params[0] ?? '')
      const updatedAt = String(params[1] ?? '')
      const draftId = String(params[2] ?? '')
      const draft = this.newsletterDrafts.get(draftId)
      if (draft && draft.status === 'draft') {
        draft.subject = subject
        draft.updatedAt = updatedAt
        return { meta: { changes: 1 } }
      }
      return { meta: { changes: 0 } }
    }

    if (
      normalized.includes('delete from newsletterdraft where deletedat is not null') &&
      normalized.includes("where kind = 'draft'")
    ) {
      let changes = 0
      for (const [draftId, draft] of Array.from(this.newsletterDrafts.entries())) {
        const job = this.trashPurgeJobs.get(`draft:${draft.newsletterId}:${draft.id}`)
        if (
          draft.deletedAt &&
          !this.newsletters.get(draft.newsletterId)?.deletedAt &&
          job
        ) {
          this.newsletterDrafts.delete(draftId)
          changes += 1
        }
      }
      return { meta: { changes } }
    }

    if (normalized.includes('delete from newsletterdraft where id = ?')) {
      const draftId = String(params[0] ?? '')
      const newsletterId = params.length > 1 ? String(params[1] ?? '') : null
      const draft = this.newsletterDrafts.get(draftId)
      const hasPurgeJob = !normalized.includes('from trashpurgejob') || Boolean(
        newsletterId && this.trashPurgeJobs.has(`draft:${newsletterId}:${draftId}`)
      )
      const deleted = Boolean(
        draft &&
        (!newsletterId || draft.newsletterId === newsletterId) &&
        (!normalized.includes('deletedat is not null') || draft.deletedAt) &&
        hasPurgeJob
      ) && this.newsletterDrafts.delete(draftId)
      return { meta: { changes: deleted ? 1 : 0 } }
    }

    if (
      normalized.includes('delete from newsletterdraft') &&
      normalized.includes('where newsletter_id in (select n.id')
    ) {
      const newsletterId = params.length > 0 ? String(params[0] ?? '') : undefined
      const purgeIds = this.newsletterPurgeJobIds(newsletterId)
      let changes = 0
      for (const [draftId, draft] of Array.from(this.newsletterDrafts.entries())) {
        if (purgeIds.has(draft.newsletterId)) {
          this.newsletterDrafts.delete(draftId)
          changes += 1
        }
      }
      return { meta: { changes } }
    }

    if (
      normalized.includes('delete from newsletterdraft where deletedat is not null') ||
      normalized.includes('delete from newsletterdraft where deletedat is not null or newsletter_id in')
    ) {
      const trashedNewsletterIds = new Set(
        Array.from(this.newsletters.values())
          .filter((newsletter) => Boolean(newsletter.deletedAt))
          .map((newsletter) => newsletter.id)
      )
      let changes = 0
      for (const [draftId, draft] of Array.from(this.newsletterDrafts.entries())) {
        if (draft.deletedAt || trashedNewsletterIds.has(draft.newsletterId)) {
          this.newsletterDrafts.delete(draftId)
          changes += 1
        }
      }
      return { meta: { changes } }
    }

    if (normalized.includes('delete from newsletterdraft where newsletter_id = ?')) {
      const newsletterId = String(params[0] ?? '')
      let changes = 0
      for (const [draftId, draft] of Array.from(this.newsletterDrafts.entries())) {
        if (draft.newsletterId === newsletterId) {
          this.newsletterDrafts.delete(draftId)
          changes += 1
        }
      }
      return { meta: { changes } }
    }

    if (
      normalized.includes('delete from subscriber where deleted_at is not null') &&
      normalized.includes('where id = subscriber.newsletter_id and deletedat is null')
    ) {
      let changes = 0
      for (const [subscriberId, subscriber] of Array.from(this.subscribers.entries())) {
        if (
          subscriber.deletedAt &&
          !this.newsletters.get(subscriber.newsletterId)?.deletedAt
        ) {
          this.subscribers.delete(subscriberId)
          changes += 1
        }
      }
      return { meta: { changes } }
    }

    if (
      normalized.includes('delete from subscriber') &&
      normalized.includes('where newsletter_id in (select n.id')
    ) {
      const newsletterId = params.length > 0 ? String(params[0] ?? '') : undefined
      const purgeIds = this.newsletterPurgeJobIds(newsletterId)
      let changes = 0
      for (const [subscriberId, subscriber] of Array.from(this.subscribers.entries())) {
        if (purgeIds.has(subscriber.newsletterId)) {
          this.subscribers.delete(subscriberId)
          changes += 1
        }
      }
      return { meta: { changes } }
    }

    if (normalized.includes('delete from subscriber where newsletter_id = ?')) {
      const newsletterId = String(params[0] ?? '')
      let changes = 0
      for (const [subscriberId, subscriber] of Array.from(this.subscribers.entries())) {
        if (subscriber.newsletterId === newsletterId) {
          this.subscribers.delete(subscriberId)
          changes += 1
        }
      }
      return { meta: { changes } }
    }

    if (
      normalized.includes('delete from subscriber') &&
      normalized.includes('email = ? collate nocase') &&
      normalized.includes('newsletter_id = ?')
    ) {
      const email = String(params[0] ?? '')
      const newsletterId = String(params[1] ?? '')
      const subscriberEntry = this.subscriberEntry(newsletterId, email)
      const key = subscriberEntry?.[0] ?? `${newsletterId}:${email}`
      const subscriber = subscriberEntry?.[1]
      const newsletter = this.newsletters.get(newsletterId)
      const canDelete = Boolean(
        subscriber?.deletedAt && newsletter && !newsletter.deletedAt
      )
      if (canDelete) {
        this.subscribers.delete(key)
      }
      return { meta: { changes: canDelete ? 1 : 0 } }
    }

    if (normalized.includes('delete from subscriber where deleted_at is not null')) {
      const trashedNewsletterIds = new Set(
        Array.from(this.newsletters.values())
          .filter((newsletter) => Boolean(newsletter.deletedAt))
          .map((newsletter) => newsletter.id)
      )
      let changes = 0
      for (const [subscriberId, subscriber] of Array.from(this.subscribers.entries())) {
        if (subscriber.deletedAt || trashedNewsletterIds.has(subscriber.newsletterId)) {
          this.subscribers.delete(subscriberId)
          changes += 1
        }
      }
      return { meta: { changes } }
    }

    if (normalized.includes('delete from newslettersendevent where newsletter_id')) {
      const newsletterId = params.length > 0 ? String(params[0] ?? '') : undefined
      const purgeIds = this.newsletterPurgeJobIds(newsletterId)
      const shouldDelete = (event: NewsletterSendEventRecord) => (
        purgeIds.has(event.newsletterId)
      )
      const remaining = this.newsletterSendEvents.filter((event) => !shouldDelete(event))
      const changes = this.newsletterSendEvents.length - remaining.length
      this.newsletterSendEvents.length = 0
      this.newsletterSendEvents.push(...remaining)
      return { meta: { changes } }
    }

    if (normalized.includes('delete from newslettersendrecipient where newsletter_id')) {
      const newsletterId = params.length > 0 ? String(params[0] ?? '') : undefined
      const purgeIds = this.newsletterPurgeJobIds(newsletterId)
      let changes = 0
      for (const [recipientId, recipient] of Array.from(this.newsletterSendRecipients.entries())) {
        if (purgeIds.has(recipient.newsletterId)) {
          this.newsletterSendRecipients.delete(recipientId)
          changes += 1
        }
      }
      return { meta: { changes } }
    }

    if (normalized.includes('delete from newslettersend where newsletter_id')) {
      const newsletterId = params.length > 0 ? String(params[0] ?? '') : undefined
      const purgeIds = this.newsletterPurgeJobIds(newsletterId)
      let changes = 0
      for (const [sendId, send] of Array.from(this.newsletterSends.entries())) {
        if (purgeIds.has(send.newsletterId)) {
          this.newsletterSends.delete(sendId)
          changes += 1
        }
      }
      return { meta: { changes } }
    }

    if (
      normalized.includes('delete from newsletter where deletedat is not null') &&
      normalized.includes('from trashpurgejob')
    ) {
      const purgeIds = this.newsletterPurgeJobIds()
      let changes = 0
      for (const newsletterId of purgeIds) {
        if (this.newsletters.delete(newsletterId)) {
          changes += 1
        }
      }
      return { meta: { changes } }
    }

    if (normalized === 'delete from newsletter where deletedat is not null') {
      let changes = 0
      for (const [newsletterId, newsletter] of Array.from(this.newsletters.entries())) {
        if (newsletter.deletedAt) {
          this.newsletters.delete(newsletterId)
          changes += 1
        }
      }
      return { meta: { changes } }
    }

    if (normalized.includes('delete from newsletter where id = ?')) {
      const newsletterId = String(params[0] ?? '')
      const newsletter = this.newsletters.get(newsletterId)
      const hasPurgeJob = !normalized.includes('from trashpurgejob') ||
        this.trashPurgeJobs.has(`newsletter:${newsletterId}:${newsletterId}`)
      const deleted = Boolean(
        newsletter &&
        (!normalized.includes('deletedat is not null') || newsletter.deletedAt) &&
        hasPurgeJob
      ) && this.newsletters.delete(newsletterId)
      return { meta: { changes: deleted ? 1 : 0 } }
    }

    if (normalized.includes('delete from trashpurgejob')) {
      const kind = String(params[0] ?? '')
      const newsletterId = String(params[1] ?? '')
      const itemId = String(params[2] ?? '')
      const deleted = this.trashPurgeJobs.delete(`${kind}:${newsletterId}:${itemId}`)
      return { meta: { changes: deleted ? 1 : 0 } }
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
        footerHtml: params[9] === null ? null : String(params[9] ?? ''),
        footerText: params[10] === null ? null : String(params[10] ?? ''),
        scheduledAt: params[11] === null ? null : String(params[11] ?? ''),
        fanoutSnapshotAt: params[12] === null ? null : String(params[12] ?? ''),
        fanoutCursorEmail: null,
        fanoutCompletedAt: null,
        createdAt: String(params[13] ?? ''),
        updatedAt: String(params[14] ?? ''),
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
  db.newsletters.set(NEWSLETTER_ID, {
    id: NEWSLETTER_ID,
    subscribable: 1,
    title: 'Test Newsletter',
    description: 'Test description',
    logo: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  })

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
  let shouldFailR2Delete = options.failR2DeleteOnce ?? false
  const r2Delete = vi.fn(async (keyOrKeys: string | string[]) => {
    if (shouldFailR2Delete) {
      shouldFailR2Delete = false
      throw new Error('Simulated R2 delete failure')
    }
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys]
    for (const key of keys) {
      r2Objects.delete(key)
    }
  })
  let remainingQueueSendFailures = options.failQueueSendCount
    ?? (options.failQueueSendOnce ? 1 : 0)
  const queueSend = vi.fn(async () => {
    if (remainingQueueSendFailures > 0) {
      remainingQueueSendFailures -= 1
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
      list: vi.fn(async (options?: { prefix?: string }) => ({
        objects: Array.from(r2Objects.keys())
          .filter((key) => !options?.prefix || key.startsWith(options.prefix))
          .map((key) => ({ key })),
        truncated: false,
      })),
      delete: r2Delete,
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
    r2Delete,
    r2Objects,
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

async function putJson(
  env: Record<string, unknown>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return app.request(`https://example.com${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  }, env)
}

async function patchJson(
  env: Record<string, unknown>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return app.request(`https://example.com${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  }, env)
}

async function getJson(
  env: Record<string, unknown>,
  path: string,
  headers: Record<string, string> = {}
) {
  return app.request(`https://example.com${path}`, {
    headers,
  }, env)
}

async function deleteJson(
  env: Record<string, unknown>,
  path: string,
  headers: Record<string, string> = {}
) {
  return app.request(`https://example.com${path}`, {
    method: 'DELETE',
    headers,
  }, env)
}

function futureWholeMinute(minutesFromNow = 10) {
  const minute = Math.floor(Date.now() / 60_000) + minutesFromNow
  return new Date(minute * 60_000).toISOString()
}

async function runScheduledHandler(env: ReturnType<typeof createEnv>['env']) {
  const pending: Promise<unknown>[] = []
  const context = {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise)
    },
  } as unknown as ExecutionContext
  await worker.scheduled(
    {} as ScheduledController,
    env,
    context
  )
  await Promise.all(pending)
}

async function createScheduledDraft(
  env: ReturnType<typeof createEnv>['env'],
  input: {
    subject?: string
    html?: string
    text?: string
    sourceMessageId?: string
    scheduledAt?: string
  } = {}
) {
  const subject = input.subject ?? 'Scheduled title'
  const html = input.html ?? '<p>Scheduled body</p>'
  const text = input.text ?? 'Scheduled body'
  const createResponse = await postJson(
    env,
    `/api/newsletter/${NEWSLETTER_ID}/drafts`,
    {
      subject,
      html,
      text,
      sourceMessageId: input.sourceMessageId ?? 'scheduled-source-id',
    },
    { Authorization: 'Bearer admin-token' }
  )
  expect(createResponse.status).toBe(201)
  const created = await createResponse.json() as {
    draft: { id: string; sourceMessageId: string }
  }
  const scheduledAt = input.scheduledAt ?? futureWholeMinute()
  const scheduleResponse = await postJson(
    env,
    `/api/newsletter/${NEWSLETTER_ID}/drafts/${created.draft.id}/schedule`,
    {
      subject,
      html,
      text,
      sourceMessageId: created.draft.sourceMessageId,
      scheduledAt,
    },
    { Authorization: 'Bearer admin-token' }
  )
  expect(scheduleResponse.status).toBe(200)
  const scheduled = await scheduleResponse.json() as {
    scheduledSend: {
      draftId: string
      scheduledAt: string
      state: string
    }
  }
  return { created, scheduled, scheduledAt }
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

function recipientEntriesFromQueueBody(body: Record<string, unknown>) {
  if (body.kind === 'recipientBatch') {
    return body.recipients as Array<{ email: string; recipientHash: string }>
  }
  return [{
    email: String(body.email ?? ''),
    recipientHash: String(body.recipientHash ?? ''),
  }]
}

function firstRecipientHashFromQueueBody(body: Record<string, unknown>) {
  return recipientEntriesFromQueueBody(body)[0]?.recipientHash ?? ''
}

function notificationSuccessResponse(messageId = 'ses-message-id') {
  return new Response(JSON.stringify({ message: 'success', messageId }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
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
      '/api/newsletter/email-style-config',
      '/api/newsletter/ses-diagnostics',
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers`,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers/import`,
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

describe('admin subscriber notes', () => {
  const adminHeaders = { Authorization: 'Bearer admin-token' }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('creates and lists normalized notes while preserving them when omitted', async () => {
    const { env, db } = createEnv()
    const createResponse = await postJson(env, `/api/newsletter/${NEWSLETTER_ID}/subscribers`, {
      subscribers: [{
        email: ' Person@Example.com ',
        firstName: ' Ada ',
        lastName: ' Lovelace ',
        notes: '  Met at the conference.\nFollow up in August.  ',
      }],
    }, adminHeaders)

    expect(createResponse.status).toBe(201)
    const subscriberKey = `${NEWSLETTER_ID}:person@example.com`
    expect(db.subscribers.get(subscriberKey)?.notes).toBe(
      'Met at the conference.\nFollow up in August.'
    )

    const malformedResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers`,
      { subscribers: [{ email: 'person@example.com', notes: false }] },
      adminHeaders
    )
    expect(malformedResponse.status).toBe(400)
    await expect(malformedResponse.json()).resolves.toEqual({
      error: 'notes must be a string or null',
    })
    expect(db.subscribers.get(subscriberKey)?.notes).toBe(
      'Met at the conference.\nFollow up in August.'
    )

    const listResponse = await getJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers`,
      adminHeaders
    )
    expect(listResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toMatchObject({
      subscribers: [{
        email: 'person@example.com',
        notes: 'Met at the conference.\nFollow up in August.',
      }],
      pagination: { total: 1 },
    })

    const upsertResponse = await postJson(env, `/api/newsletter/${NEWSLETTER_ID}/subscribers`, {
      subscribers: [{ email: 'person@example.com', firstName: 'Augusta' }],
    }, adminHeaders)
    expect(upsertResponse.status).toBe(201)
    expect(db.subscribers.get(subscriberKey)?.notes).toBe(
      'Met at the conference.\nFollow up in August.'
    )
  })

  it('updates and clears notes through the single-subscriber endpoint', async () => {
    const { env, db } = createEnv()
    const subscriberKey = `${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`
    db.subscribers.set(subscriberKey, {
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
      firstName: 'Ada',
      lastName: 'Lovelace',
      notes: 'Old note',
      isSubscribed: 1,
    })

    const updateResponse = await patchJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers/${SUBSCRIBER_EMAIL}`,
      {
        email: SUBSCRIBER_EMAIL,
        firstName: ' Grace ',
        lastName: ' Hopper ',
        notes: '  New note\nwith context.  ',
      },
      adminHeaders
    )
    expect(updateResponse.status).toBe(200)
    expect(db.subscribers.get(subscriberKey)).toMatchObject({
      firstName: 'Grace',
      lastName: 'Hopper',
      notes: 'New note\nwith context.',
    })

    const clearResponse = await patchJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers/${SUBSCRIBER_EMAIL}`,
      {
        email: SUBSCRIBER_EMAIL,
        firstName: 'Grace',
        lastName: 'Hopper',
        notes: '  \n  ',
      },
      adminHeaders
    )
    expect(clearResponse.status).toBe(200)
    expect(db.subscribers.get(subscriberKey)?.notes).toBeNull()
  })

  it('matches legacy mixed-case subscribers across admin and Trash mutations', async () => {
    const { env, db } = createEnv()
    const storedEmail = 'Legacy.User@Example.com'
    const normalizedEmail = storedEmail.toLowerCase()
    const subscriberKey = `${NEWSLETTER_ID}:${storedEmail}`
    db.subscribers.set(subscriberKey, {
      email: storedEmail,
      newsletterId: NEWSLETTER_ID,
      firstName: 'Legacy',
      lastName: 'User',
      notes: null,
      isSubscribed: 1,
    })
    db.subscribers.set(`${NEWSLETTER_ID}:Conflict@Example.com`, {
      email: 'Conflict@Example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      notes: null,
      isSubscribed: 1,
    })

    const updateResponse = await patchJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers/${normalizedEmail}`,
      {
        email: normalizedEmail,
        firstName: 'Legacy',
        lastName: 'User',
        notes: 'Case-insensitive update',
      },
      adminHeaders
    )
    expect(updateResponse.status).toBe(200)
    expect(db.subscribers.get(subscriberKey)).toMatchObject({
      email: storedEmail,
      notes: 'Case-insensitive update',
    })
    expect(db.subscribers.has(`${NEWSLETTER_ID}:${normalizedEmail}`)).toBe(false)

    const conflictResponse = await patchJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers/${normalizedEmail}`,
      {
        email: 'conflict@example.com',
        firstName: 'Legacy',
        lastName: 'User',
        notes: null,
      },
      adminHeaders
    )
    expect(conflictResponse.status).toBe(409)

    const removeResponse = await deleteJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers/${normalizedEmail}`,
      adminHeaders
    )
    expect(removeResponse.status).toBe(200)
    expect(db.subscribers.get(subscriberKey)).toMatchObject({
      isSubscribed: 0,
      deletedAt: expect.any(String),
    })

    const restoreResponse = await postJson(
      env,
      `/api/newsletter/trash/newsletters/${NEWSLETTER_ID}/subscribers/${normalizedEmail}/restore`,
      {},
      adminHeaders
    )
    expect(restoreResponse.status).toBe(200)
    expect(db.subscribers.get(subscriberKey)).toMatchObject({
      email: storedEmail,
      isSubscribed: 0,
      deletedAt: null,
    })

    const secondRemoveResponse = await deleteJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers/${normalizedEmail}`,
      adminHeaders
    )
    expect(secondRemoveResponse.status).toBe(200)
    const purgeResponse = await deleteJson(
      env,
      `/api/newsletter/trash/newsletters/${NEWSLETTER_ID}/subscribers/${normalizedEmail}`,
      adminHeaders
    )
    expect(purgeResponse.status).toBe(200)
    expect(db.subscribers.has(subscriberKey)).toBe(false)
  })

  it('renames a subscriber without changing subscription lifecycle state', async () => {
    const { env, db } = createEnv()
    const originalKey = `${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`
    const subscribedAt = '2026-01-01T00:00:00.000Z'
    const unsubscribedAt = '2026-02-01T00:00:00.000Z'
    db.subscribers.set(originalKey, {
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
      firstName: 'Ada',
      lastName: 'Lovelace',
      notes: 'Manager note',
      isSubscribed: 0,
      subscribedAt,
      unsubscribedAt,
      deletedAt: null,
    })

    const response = await patchJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers/${SUBSCRIBER_EMAIL}`,
      {
        email: 'renamed@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        notes: 'Manager note',
      },
      adminHeaders
    )

    expect(response.status).toBe(200)
    expect(db.subscribers.has(originalKey)).toBe(false)
    expect(db.subscribers.get(`${NEWSLETTER_ID}:renamed@example.com`)).toMatchObject({
      isSubscribed: 0,
      subscribedAt,
      unsubscribedAt,
      notes: 'Manager note',
    })
  })

  it('updates subscriber state and its lifecycle timestamps', async () => {
    const { env, db } = createEnv()
    const subscriberKey = `${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`
    const originalSubscribedAt = '2026-01-01T00:00:00.000Z'
    db.subscribers.set(subscriberKey, {
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
      firstName: 'Ada',
      lastName: 'Lovelace',
      notes: null,
      isSubscribed: 1,
      subscribedAt: originalSubscribedAt,
      unsubscribedAt: null,
      deletedAt: null,
    })

    const unsubscribeResponse = await patchJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers/${SUBSCRIBER_EMAIL}`,
      {
        email: SUBSCRIBER_EMAIL,
        firstName: 'Ada',
        lastName: 'Lovelace',
        notes: null,
        isSubscribed: false,
      },
      adminHeaders
    )

    expect(unsubscribeResponse.status).toBe(200)
    expect(db.subscribers.get(subscriberKey)).toMatchObject({
      isSubscribed: 0,
      subscribedAt: originalSubscribedAt,
      unsubscribedAt: expect.any(String),
    })

    const resubscribeResponse = await patchJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers/${SUBSCRIBER_EMAIL}`,
      {
        email: SUBSCRIBER_EMAIL,
        firstName: 'Ada',
        lastName: 'Lovelace',
        notes: null,
        isSubscribed: true,
      },
      adminHeaders
    )

    expect(resubscribeResponse.status).toBe(200)
    expect(db.subscribers.get(subscriberKey)).toMatchObject({
      isSubscribed: 1,
      unsubscribedAt: null,
      deletedAt: null,
    })
    expect(db.subscribers.get(subscriberKey)?.subscribedAt).not.toBe(originalSubscribedAt)
  })

  it('rejects conflicting email changes and updates to unknown subscribers', async () => {
    const { env, db } = createEnv()
    for (const email of [SUBSCRIBER_EMAIL, 'existing@example.com']) {
      db.subscribers.set(`${NEWSLETTER_ID}:${email}`, {
        email,
        newsletterId: NEWSLETTER_ID,
        firstName: null,
        lastName: null,
        notes: null,
        isSubscribed: 1,
      })
    }

    const conflictResponse = await patchJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers/${SUBSCRIBER_EMAIL}`,
      {
        email: 'existing@example.com',
        firstName: null,
        lastName: null,
        notes: null,
      },
      adminHeaders
    )
    expect(conflictResponse.status).toBe(409)
    await expect(conflictResponse.json()).resolves.toEqual({
      error: 'A subscriber with that email already exists',
    })

    const missingResponse = await patchJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers/missing@example.com`,
      {
        email: 'missing@example.com',
        firstName: null,
        lastName: null,
        notes: null,
      },
      adminHeaders
    )
    expect(missingResponse.status).toBe(404)
    await expect(missingResponse.json()).resolves.toEqual({ error: 'Subscriber not found' })
  })

  it('rejects partial and malformed updates without changing stored fields', async () => {
    const { env, db } = createEnv()
    const subscriberKey = `${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`
    db.subscribers.set(subscriberKey, {
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
      firstName: 'Ada',
      lastName: 'Lovelace',
      notes: 'Private context',
      isSubscribed: 1,
    })

    const partialResponse = await patchJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers/${SUBSCRIBER_EMAIL}`,
      { email: SUBSCRIBER_EMAIL },
      adminHeaders
    )
    expect(partialResponse.status).toBe(400)
    await expect(partialResponse.json()).resolves.toEqual({ error: 'firstName is required' })

    const malformedResponse = await patchJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers/${SUBSCRIBER_EMAIL}`,
      {
        email: SUBSCRIBER_EMAIL,
        firstName: 42,
        lastName: 'Lovelace',
        notes: 'Replacement context',
      },
      adminHeaders
    )
    expect(malformedResponse.status).toBe(400)
    await expect(malformedResponse.json()).resolves.toEqual({
      error: 'firstName must be a string or null',
    })

    const malformedStatusResponse = await patchJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers/${SUBSCRIBER_EMAIL}`,
      {
        email: SUBSCRIBER_EMAIL,
        firstName: 'Ada',
        lastName: 'Lovelace',
        notes: 'Replacement context',
        isSubscribed: 'yes',
      },
      adminHeaders
    )
    expect(malformedStatusResponse.status).toBe(400)
    await expect(malformedStatusResponse.json()).resolves.toEqual({
      error: 'isSubscribed must be a boolean',
    })
    expect(db.subscribers.get(subscriberKey)).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      notes: 'Private context',
    })
  })

  it('updates an email containing an encoded path separator', async () => {
    const { env, db } = createEnv()
    const email = 'a/b@example.com'
    db.subscribers.set(`${NEWSLETTER_ID}:${email}`, {
      email,
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      notes: null,
      isSubscribed: 1,
    })

    const response = await patchJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers/a%2Fb%40example.com`,
      {
        email,
        firstName: null,
        lastName: null,
        notes: 'Encoded path works',
      },
      adminHeaders
    )

    expect(response.status).toBe(200)
    expect(db.subscribers.get(`${NEWSLETTER_ID}:${email}`)?.notes).toBe(
      'Encoded path works'
    )
  })
})

describe('admin subscriber pagination', () => {
  const adminHeaders = { Authorization: 'Bearer admin-token' }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  function seedSubscribers(db: FakeD1Database, count: number) {
    for (let index = 0; index < count; index += 1) {
      const email = `subscriber-${String(index).padStart(4, '0')}@example.com`
      db.subscribers.set(`${NEWSLETTER_ID}:${email}`, {
        email,
        newsletterId: NEWSLETTER_ID,
        firstName: null,
        lastName: null,
        isSubscribed: 1,
        upsertedAt: new Date(index * 1_000).toISOString(),
      })
    }
  }

  it('returns subscriber pages of up to 1000 rows with accurate metadata', async () => {
    const { env, db } = createEnv()
    seedSubscribers(db, 1_001)

    const firstResponse = await getJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers?page=1&limit=1000`,
      adminHeaders
    )
    const secondResponse = await getJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers?page=2&limit=1000`,
      adminHeaders
    )

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    const firstPage = await firstResponse.json() as {
      subscribers: unknown[]
      pagination: { page: number; limit: number; total: number }
    }
    const secondPage = await secondResponse.json() as {
      subscribers: unknown[]
      pagination: { page: number; limit: number; total: number }
    }
    expect(firstPage.subscribers).toHaveLength(1_000)
    expect(firstPage.pagination).toEqual({ page: 1, limit: 1_000, total: 1_001 })
    expect(secondPage.subscribers).toHaveLength(1)
    expect(secondPage.pagination).toEqual({ page: 2, limit: 1_000, total: 1_001 })
  })

  it('clamps only subscriber lists to the larger maximum', async () => {
    const { env, db } = createEnv()
    seedSubscribers(db, 1_001)

    const subscriberResponse = await getJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/subscribers?limit=5000`,
      adminHeaders
    )
    const newsletterResponse = await getJson(
      env,
      '/api/newsletter?limit=5000',
      adminHeaders
    )

    const subscriberPage = await subscriberResponse.json() as {
      subscribers: unknown[]
      pagination: { limit: number }
    }
    const newsletterPage = await newsletterResponse.json() as {
      pagination: { limit: number }
    }
    expect(subscriberPage.subscribers).toHaveLength(1_000)
    expect(subscriberPage.pagination.limit).toBe(1_000)
    expect(newsletterPage.pagination.limit).toBe(100)
  })
})

describe('admin subscriber imports', () => {
  const adminHeaders = { Authorization: 'Bearer admin-token' }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('skips existing unsubscribed subscribers by default', async () => {
    const { env, db } = createEnv()
    const storedEmail = 'Unsubscribed@Example.com'
    const subscriberKey = `${NEWSLETTER_ID}:${storedEmail}`
    const unsubscribedAt = '2026-02-01T00:00:00.000Z'
    db.subscribers.set(subscriberKey, {
      email: storedEmail,
      newsletterId: NEWSLETTER_ID,
      firstName: 'Original',
      lastName: 'Subscriber',
      isSubscribed: 0,
      unsubscribedAt,
    })

    const response = await postJson(env, `/api/newsletter/${NEWSLETTER_ID}/subscribers/import`, {
      subscribers: [
        { email: 'new@example.com', firstName: 'New' },
        { email: 'unsubscribed@example.com', firstName: 'Replacement' },
      ],
    }, adminHeaders)

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      importedCount: 1,
      skippedUnsubscribedCount: 1,
    })
    expect(db.subscribers.get(`${NEWSLETTER_ID}:new@example.com`)?.isSubscribed).toBe(1)
    expect(db.subscribers.get(subscriberKey)).toMatchObject({
      firstName: 'Original',
      isSubscribed: 0,
      unsubscribedAt,
    })
  })

  it('resubscribes existing unsubscribed subscribers only with an explicit override', async () => {
    const { env, db } = createEnv()
    const storedEmail = 'Unsubscribed@Example.com'
    const subscriberKey = `${NEWSLETTER_ID}:${storedEmail}`
    db.subscribers.set(subscriberKey, {
      email: storedEmail,
      newsletterId: NEWSLETTER_ID,
      firstName: 'Original',
      lastName: null,
      isSubscribed: 0,
      unsubscribedAt: '2026-02-01T00:00:00.000Z',
    })

    const response = await postJson(env, `/api/newsletter/${NEWSLETTER_ID}/subscribers/import`, {
      subscribers: [{ email: 'unsubscribed@example.com', firstName: 'Updated' }],
      resubscribeUnsubscribed: true,
    }, adminHeaders)

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      importedCount: 1,
      skippedUnsubscribedCount: 0,
    })
    expect(db.subscribers.get(subscriberKey)).toMatchObject({
      email: storedEmail,
      firstName: 'Updated',
      isSubscribed: 1,
      unsubscribedAt: null,
    })
  })

  it('rejects a non-boolean resubscribe override', async () => {
    const { env } = createEnv()
    const response = await postJson(env, `/api/newsletter/${NEWSLETTER_ID}/subscribers/import`, {
      subscribers: [{ email: 'person@example.com' }],
      resubscribeUnsubscribed: 'yes',
    }, adminHeaders)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'resubscribeUnsubscribed must be a boolean',
    })
  })

  it('preserves the existing add endpoint resubscription behavior', async () => {
    const { env, db } = createEnv()
    const storedEmail = 'Unsubscribed@Example.com'
    const subscriberKey = `${NEWSLETTER_ID}:${storedEmail}`
    db.subscribers.set(subscriberKey, {
      email: storedEmail,
      newsletterId: NEWSLETTER_ID,
      firstName: 'Original',
      lastName: null,
      isSubscribed: 0,
      unsubscribedAt: '2026-02-01T00:00:00.000Z',
    })

    const response = await postJson(env, `/api/newsletter/${NEWSLETTER_ID}/subscribers`, {
      subscribers: [{ email: 'unsubscribed@example.com', firstName: 'Updated' }],
    }, adminHeaders)

    expect(response.status).toBe(201)
    expect(db.subscribers.get(subscriberKey)).toMatchObject({
      email: storedEmail,
      firstName: 'Updated',
      isSubscribed: 1,
      unsubscribedAt: null,
    })
    expect(db.subscribers.has(`${NEWSLETTER_ID}:unsubscribed@example.com`)).toBe(false)
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

describe('email style config', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns factory defaults when KV is absent or corrupt', async () => {
    const { env } = createEnv()
    const absentResponse = await getJson(
      env,
      '/api/newsletter/email-style-config',
      { Authorization: 'Bearer admin-token' }
    )
    await env.KV.put('email-style-config-v1', '{corrupt')
    const corruptResponse = await getJson(
      env,
      '/api/newsletter/email-style-config',
      { Authorization: 'Bearer admin-token' }
    )

    expect(absentResponse.status).toBe(200)
    await expect(absentResponse.json()).resolves.toEqual(factoryEmailStyleConfig())
    expect(corruptResponse.status).toBe(200)
    await expect(corruptResponse.json()).resolves.toEqual(factoryEmailStyleConfig())
  })

  it('adds the spacing default to a stored legacy rich link preview configuration', async () => {
    const { env } = createEnv()
    const legacyConfig = structuredClone(factoryEmailStyleConfig())
    legacyConfig.linkPreviews.fontFamily = 'georgia'
    const legacyLinkPreviews = legacyConfig.linkPreviews as Partial<
      typeof legacyConfig.linkPreviews
    >
    delete legacyLinkPreviews.titleURLSpacingPx
    await env.KV.put('email-style-config-v1', JSON.stringify(legacyConfig))

    const response = await getJson(
      env,
      '/api/newsletter/email-style-config',
      { Authorization: 'Bearer admin-token' }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ...legacyConfig,
      linkPreviews: {
        ...legacyConfig.linkPreviews,
        titleURLSpacingPx: 8,
      },
    })
  })

  it('accepts a full replacement from a legacy client without rich link preview settings', async () => {
    const { env } = createEnv()
    const legacyConfig = structuredClone(factoryEmailStyleConfig()) as Partial<
      ReturnType<typeof factoryEmailStyleConfig>
    >
    delete legacyConfig.linkPreviews

    const response = await putJson(
      env,
      '/api/newsletter/email-style-config',
      legacyConfig,
      { Authorization: 'Bearer admin-token' }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ...legacyConfig,
      linkPreviews: factoryEmailStyleConfig().linkPreviews,
    })
  })

  it('stores and returns a full replacement configuration', async () => {
    const { env } = createEnv()
    const config = factoryEmailStyleConfig()
    config.layout.maxWidthPx = 680
    config.layout.contentPaddingHorizontalPx = 24
    config.body.fontFamily = 'georgia'
    config.headings.h2.fontSizePx = 31
    config.links.underline = false
    config.linkPreviews.fontFamily = 'georgia'
    config.linkPreviews.titleFontSizePx = 28
    config.linkPreviews.hostFontSizePx = 14
    config.linkPreviews.titleURLSpacingPx = 32

    const saveResponse = await putJson(
      env,
      '/api/newsletter/email-style-config',
      config,
      { Authorization: 'Bearer admin-token' }
    )
    const getResponse = await getJson(
      env,
      '/api/newsletter/email-style-config',
      { Authorization: 'Bearer admin-token' }
    )

    expect(saveResponse.status).toBe(200)
    await expect(saveResponse.json()).resolves.toEqual(config)
    expect(getResponse.status).toBe(200)
    await expect(getResponse.json()).resolves.toEqual(config)
  })

  it('rejects missing, unknown, and out-of-range values', async () => {
    const { env } = createEnv()
    const missing = structuredClone(factoryEmailStyleConfig()) as Partial<
      ReturnType<typeof factoryEmailStyleConfig>
    >
    delete missing.links
    const unknown = structuredClone(factoryEmailStyleConfig())
    const unknownBody = unknown.body as typeof unknown.body & { color?: string }
    unknownBody.color = '#fff'
    const outOfRange = structuredClone(factoryEmailStyleConfig())
    outOfRange.body.fontSizePx = 73
    const unsupportedWeight = structuredClone(factoryEmailStyleConfig())
    unsupportedWeight.body.fontWeight = 550
    const outOfRangeLinkPreview = structuredClone(factoryEmailStyleConfig())
    outOfRangeLinkPreview.linkPreviews.titleFontSizePx = 49
    const outOfRangeLinkPreviewSpacing = structuredClone(factoryEmailStyleConfig())
    outOfRangeLinkPreviewSpacing.linkPreviews.titleURLSpacingPx = 161

    for (const config of [
      missing,
      unknown,
      outOfRange,
      unsupportedWeight,
      outOfRangeLinkPreview,
      outOfRangeLinkPreviewSpacing,
    ]) {
      const response = await putJson(
        env,
        '/api/newsletter/email-style-config',
        config,
        { Authorization: 'Bearer admin-token' }
      )
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: expect.any(String) })
    }
  })
})

describe('unsubscribe footer config', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the legacy footer by default and persists a custom rich footer', async () => {
    const { env } = createEnv()
    const defaultResponse = await getJson(
      env,
      '/api/newsletter/footer-config',
      { Authorization: 'Bearer admin-token' }
    )
    const custom = {
      html: `<p><strong>Thanks for reading.</strong> <a href="https://example.com">Site</a> <a href="${UNSUBSCRIBE_PLACEHOLDER_URL}">Leave this list</a></p>`,
      text: `Thanks for reading. Site Leave this list: ${UNSUBSCRIBE_PLACEHOLDER_URL}`,
    }
    const saveResponse = await putJson(
      env,
      '/api/newsletter/footer-config',
      custom,
      { Authorization: 'Bearer admin-token' }
    )
    const getResponse = await getJson(
      env,
      '/api/newsletter/footer-config',
      { Authorization: 'Bearer admin-token' }
    )

    expect(defaultResponse.status).toBe(200)
    await expect(defaultResponse.json()).resolves.toEqual({
      html: `<p style="font-size: 12px;">You are receiving this email because you subscribed to this newsletter. <a href="${UNSUBSCRIBE_PLACEHOLDER_URL}">Unsubscribe</a></p>`,
      text: `You are receiving this email because you subscribed to this newsletter.\nUnsubscribe: ${UNSUBSCRIBE_PLACEHOLDER_URL}`,
    })
    expect(saveResponse.status).toBe(200)
    await expect(saveResponse.json()).resolves.toEqual(custom)
    expect(getResponse.status).toBe(200)
    await expect(getResponse.json()).resolves.toEqual(custom)
  })

  it('requires exactly one placeholder link in both representations', async () => {
    const { env } = createEnv()
    const missingResponse = await putJson(
      env,
      '/api/newsletter/footer-config',
      { html: '<p>No unsubscribe link</p>', text: 'No unsubscribe link' },
      { Authorization: 'Bearer admin-token' }
    )
    const duplicateResponse = await putJson(
      env,
      '/api/newsletter/footer-config',
      {
        html: `<a href="${UNSUBSCRIBE_PLACEHOLDER_URL}">One</a><a href="${UNSUBSCRIBE_PLACEHOLDER_URL}">Two</a>`,
        text: `${UNSUBSCRIBE_PLACEHOLDER_URL}\n${UNSUBSCRIBE_PLACEHOLDER_URL}`,
      },
      { Authorization: 'Bearer admin-token' }
    )

    expect(missingResponse.status).toBe(400)
    await expect(missingResponse.json()).resolves.toEqual({
      error: 'Footer html must contain exactly one unsubscribe link',
    })
    expect(duplicateResponse.status).toBe(400)
    await expect(duplicateResponse.json()).resolves.toEqual({
      error: 'Footer html must contain exactly one unsubscribe link',
    })
  })

  it('rejects footer templates larger than 64 KiB', async () => {
    const { env } = createEnv()
    const response = await putJson(
      env,
      '/api/newsletter/footer-config',
      {
        html: `<a href="${UNSUBSCRIBE_PLACEHOLDER_URL}">Unsubscribe</a>${'x'.repeat(65_536)}`,
        text: `Unsubscribe: ${UNSUBSCRIBE_PLACEHOLDER_URL}`,
      },
      { Authorization: 'Bearer admin-token' }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Footer html and text must each be 64 KiB or smaller',
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
    const storedHtml = String(
      r2Put.mock.calls.find(([key]) => key === result.fileName)?.[1]
    )
    expect(storedHtml).toContain('<style id="letterdrop-global-email-styles">')
    expect(storedHtml).toContain('<!-- letterdrop-content-start --><h1>Hello direct subscribers</h1>')
    expect(storedHtml).toContain('<meta name="color-scheme" content="light dark">')
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
      kind: 'recipientBatch',
      recipients: [
        expect.objectContaining({
          email: 'first@example.com',
          recipientHash: expect.any(String),
        }),
      ],
    }))
    expect(db.newsletterSends.get(result.sendId)?.queuedCount).toBe(1)
    expect(db.newsletterSendRecipients.size).toBe(1)
  })

  it('snapshots configured styling, preserves inline overrides, and reprocesses idempotently', async () => {
    const {
      env,
      db,
      notificationFetch,
      r2Put,
      queueSend,
      queueSendBatch,
    } = createEnv()
    db.subscribers.set(`${NEWSLETTER_ID}:first@example.com`, {
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })
    const config = factoryEmailStyleConfig()
    config.layout.maxWidthPx = 640
    config.layout.outerPaddingHorizontalPx = 24
    config.layout.contentPaddingVerticalPx = 16
    config.body.fontFamily = 'georgia'
    config.body.fontSizePx = 18
    config.links.underline = false
    config.linkPreviews.fontFamily = 'arial'
    config.linkPreviews.titleFontSizePx = 29
    config.linkPreviews.hostFontSizePx = 13
    config.linkPreviews.titleURLSpacingPx = 27
    const saveResponse = await putJson(
      env,
      '/api/newsletter/email-style-config',
      config,
      { Authorization: 'Bearer admin-token' }
    )
    expect(saveResponse.status).toBe(200)
    const sourceHtml = '<!doctype html><html><head><title>Source title</title></head><body><h1 style="font-size: 44px">Styled heading</h1><p><a href="https://example.com" style="text-decoration: underline">Link</a></p></body></html>'

    const firstResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      {
        subject: 'Styled send',
        html: sourceHtml,
        text: 'Styled heading\n\nLink',
        sourceMessageId: 'styled-snapshot',
      },
      { Authorization: 'Bearer admin-token' }
    )
    const first = await firstResponse.json()
    const firstObject = await env.R2.get(first.fileName)
    const firstHtml = await firstObject?.text() ?? ''

    expect(firstResponse.status).toBe(200)
    expect(firstHtml).toContain('<title>Source title</title>')
    expect(firstHtml).toContain('max-width: 640px')
    expect(firstHtml).toContain('padding: 8px 24px')
    expect(firstHtml).toContain('padding: 16px 0px')
    expect(firstHtml).toContain('font-family: Georgia, "Times New Roman", serif')
    expect(firstHtml).toContain('text-decoration: none')
    expect(firstHtml).toContain('.letterdrop-link-preview-title')
    expect(firstHtml).toContain('font-size: 29px !important')
    expect(firstHtml).toContain('font-size: 13px !important')
    expect(firstHtml).toContain('padding-top: 27px !important')
    expect(firstHtml).toContain('style="font-size: 44px"')
    expect(firstHtml.match(/letterdrop-content-start/g)).toHaveLength(1)
    expect(firstHtml.match(/letterdrop-global-email-styles/g)).toHaveLength(1)
    expect(firstHtml).toContain('#FFFFFF')
    expect(firstHtml).toContain('#1C1C1E')
    expect(firstHtml).toContain('@media (prefers-color-scheme: dark)')

    const recipientMessages = await drainFirstFanoutJob(env, queueSend, queueSendBatch)
    await worker.queue(createQueueBatch(recipientMessages[0]).batch, env)
    const delivery = await getNotificationRequestBody(notificationFetch)
    const deliveryHtml = String(delivery.html)
    expect(deliveryHtml.indexOf('class="letterdrop-footer"')).toBeGreaterThan(
      deliveryHtml.indexOf('<!-- letterdrop-content-end -->')
    )
    expect(deliveryHtml.indexOf('class="letterdrop-footer"')).toBeLessThan(
      deliveryHtml.indexOf('</body>')
    )

    const reprocessedResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      {
        subject: 'Reprocessed style shell',
        html: firstHtml,
        text: 'Styled heading\n\nLink',
        sourceMessageId: 'styled-reprocessed',
      },
      { Authorization: 'Bearer admin-token' }
    )
    const reprocessed = await reprocessedResponse.json()
    const reprocessedObject = await env.R2.get(reprocessed.fileName)
    await expect(reprocessedObject?.text()).resolves.toBe(firstHtml)

    const changedConfig = structuredClone(config)
    changedConfig.body.fontFamily = 'arial'
    await putJson(
      env,
      '/api/newsletter/email-style-config',
      changedConfig,
      { Authorization: 'Bearer admin-token' }
    )
    const duplicateResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      {
        subject: 'Changed duplicate',
        html: '<p>Changed duplicate</p>',
        text: 'Changed duplicate',
        sourceMessageId: 'styled-snapshot',
      },
      { Authorization: 'Bearer admin-token' }
    )

    await expect(duplicateResponse.json()).resolves.toEqual(expect.objectContaining({
      sendId: first.sendId,
      duplicate: true,
    }))
    const stableObject = await env.R2.get(first.fileName)
    await expect(stableObject?.text()).resolves.toBe(firstHtml)
    expect(r2Put).toHaveBeenCalledTimes(4)
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

  it('queues exactly one recipient batch for a full fanout chunk', async () => {
    const { env, db, queueSend, queueSendBatch } = createEnv()
    for (let index = 0; index < 15; index += 1) {
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
    expect(response.status).toBe(200)

    const recipientMessages = await drainFirstFanoutJob(env, queueSend, queueSendBatch)

    expect(queueSendBatch).toHaveBeenCalledTimes(1)
    expect(recipientMessages).toHaveLength(1)
    expect(recipientMessages[0]).toEqual(expect.objectContaining({
      kind: 'recipientBatch',
      sendId: expect.any(String),
      recipients: expect.any(Array),
    }))
    expect(recipientEntriesFromQueueBody(recipientMessages[0])).toHaveLength(15)
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
      estimatedFanoutChunks: 50,
      estimatedRecipientQueueBatches: 200,
      fanoutChunkSize: 100,
      recipientBatchSize: 25,
      estimatedSesSendRatePerSecond: 14,
      estimatedSesSendSeconds: 358,
      wouldSendEmail: false,
      freePlanSafe: false,
      paidPlanOptimized: true,
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

    const recipientBatchMessageCount = queueSendBatch.mock.calls.reduce((sum, call) => (
      sum + (call[0] as Array<unknown>).length
    ), 0)
    const recipientCount = queueSendBatch.mock.calls.reduce((sum, call) => (
      sum + (call[0] as Array<{ body: Record<string, unknown> }>).reduce(
        (batchSum, entry) => batchSum + recipientEntriesFromQueueBody(entry.body).length,
        0
      )
    ), 0)
    const maxRecipientBatchSize = Math.max(...queueSendBatch.mock.calls.flatMap((call) => (
      (call[0] as Array<{ body: Record<string, unknown> }>).map((entry) =>
        recipientEntriesFromQueueBody(entry.body).length
      )
    )))
    expect(queueSendBatch).toHaveBeenCalledTimes(50)
    expect(recipientBatchMessageCount).toBe(200)
    expect(recipientCount).toBe(5000)
    expect(maxRecipientBatchSize).toBeLessThanOrEqual(25)
    expect(Math.max(...operationCounts)).toBeLessThanOrEqual(125)
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

  it('does not enqueue recipient batches until fanout counters advance', async () => {
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
    expect(queueSendBatch).not.toHaveBeenCalled()
    expect(db.newsletterSends.get(result.sendId)).toEqual(expect.objectContaining({
      queuedCount: 0,
      fanoutQueuedCount: 0,
    }))

    const secondFanout = createQueueBatch(fanoutBody)
    await worker.queue(secondFanout.batch, env)

    expect(secondFanout.message.retry).not.toHaveBeenCalled()
    expect(queueSendBatch).toHaveBeenCalledTimes(1)
    expect(db.newsletterSends.get(result.sendId)).toEqual(expect.objectContaining({
      queuedCount: 1,
      fanoutQueuedCount: 1,
      fanoutCompletedAt: expect.any(String),
    }))
  })

  it('keeps counters correct when recipient delivery starts immediately after enqueue', async () => {
    const { env, db, notificationFetch, queueSend, queueSendBatch } = createEnv()
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
    const result = await response.json() as { sendId: string }
    const fanoutBody = queueSend.mock.calls[0][0] as Record<string, unknown>
    const fanout = createQueueBatch(fanoutBody)
    notificationFetch.mockClear()
    queueSendBatch.mockImplementationOnce(async (entries: Array<{ body: Record<string, unknown> }>) => {
      expect(db.newsletterSends.get(result.sendId)).toEqual(expect.objectContaining({
        queuedCount: 1,
        fanoutQueuedCount: 1,
      }))
      const delivery = createQueueBatch(entries[0].body)
      await worker.queue(delivery.batch, env)
      expect(delivery.message.retry).not.toHaveBeenCalled()
    })

    await worker.queue(fanout.batch, env)

    expect(fanout.message.retry).not.toHaveBeenCalled()
    expect(queueSendBatch).toHaveBeenCalledTimes(1)
    expect(notificationFetch).toHaveBeenCalledTimes(1)
    expect(db.newsletterSends.get(result.sendId)).toEqual(expect.objectContaining({
      queuedCount: 0,
      providerAcceptedCount: 1,
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
    expect(recipientMessages.flatMap(recipientEntriesFromQueueBody).map((recipient) => (
      recipient.email
    ))).toEqual(['first@example.com'])
  })

  it('counts only unfanned subscribers when a later fanout job dead-letters', async () => {
    const { env, db, queueSend, queueSendBatch } = createEnv()
    for (let index = 0; index < 120; index += 1) {
      const email = `subscriber-${String(index).padStart(3, '0')}@example.com`
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
    expect(recipientBatch).toHaveLength(4)
    for (const entry of recipientBatch) {
      await worker.queue(createQueueBatch(entry.body).batch, env)
    }

    const nextFanoutBody = queueSend.mock.calls.at(-1)?.[0] as Record<string, unknown>
    const deadLetteredFanout = createQueueBatch(nextFanoutBody, 'letterdrop-test-dlq')
    await worker.queue(deadLetteredFanout.batch, env)

    expect(db.newsletterSends.get(result.sendId)).toEqual(expect.objectContaining({
      recipientCount: 120,
      queuedCount: 0,
      fanoutQueuedCount: 100,
      providerAcceptedCount: 100,
      queueFailedCount: 20,
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
    expect(db.operationCount).toBe(2)
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

describe('newsletter draft admin endpoints', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  const auth = { Authorization: 'Bearer admin-token' }

  it('rejects unauthenticated draft requests', async () => {
    const { env } = createEnv()

    const response = await getJson(env, `/api/newsletter/${NEWSLETTER_ID}/drafts`)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('creates, lists, loads, updates, and trashes active drafts', async () => {
    const { env, db, r2Put, r2Delete } = createEnv()

    const createResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts`,
      { subject: 'Draft title', html: '', text: '' },
      auth
    )
    const created = await createResponse.json()

    expect(createResponse.status).toBe(201)
    expect(created.draft).toEqual(expect.objectContaining({
      id: expect.any(String),
      newsletterId: NEWSLETTER_ID,
      subject: 'Draft title',
      sourceMessageId: expect.stringMatching(/^draft:/),
      status: 'draft',
    }))
    expect(r2Put).toHaveBeenCalledWith(created.draft.contentFileName, '')
    expect(r2Put).toHaveBeenCalledWith(created.draft.textFileName, '')

    const listResponse = await getJson(env, `/api/newsletter/${NEWSLETTER_ID}/drafts`, auth)
    await expect(listResponse.json()).resolves.toEqual({
      drafts: [created.draft],
    })

    const getResponse = await getJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts/${created.draft.id}`,
      auth
    )
    await expect(getResponse.json()).resolves.toEqual({
      draft: created.draft,
      html: '',
      text: '',
    })

    const updateResponse = await putJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts/${created.draft.id}`,
      { subject: 'Updated draft', html: '<p>Updated</p>', text: 'Updated' },
      auth
    )
    const updated = await updateResponse.json()

    expect(updateResponse.status).toBe(200)
    expect(updated).toEqual(expect.objectContaining({
      draft: expect.objectContaining({
        id: created.draft.id,
        subject: 'Updated draft',
      }),
      html: '<p>Updated</p>',
      text: 'Updated',
    }))
    expect(db.newsletterDrafts.get(created.draft.id)?.subject).toBe('Updated draft')

    const deleteResponse = await deleteJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts/${created.draft.id}`,
      auth
    )

    expect(deleteResponse.status).toBe(200)
    expect(db.newsletterDrafts.get(created.draft.id)?.deletedAt).toEqual(expect.any(String))
    expect(r2Delete).not.toHaveBeenCalled()
    const afterDelete = await getJson(env, `/api/newsletter/${NEWSLETTER_ID}/drafts`, auth)
    await expect(afterDelete.json()).resolves.toEqual({ drafts: [] })
  })

  it('treats repeated draft creates with the same sourceMessageId as an update', async () => {
    const { env, db } = createEnv()
    const firstResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts`,
      {
        subject: 'First title',
        html: '<p>First</p>',
        text: 'First',
        sourceMessageId: 'retry-source-id',
      },
      auth
    )
    const first = await firstResponse.json()

    const retryResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts`,
      {
        subject: 'Recovered title',
        html: '<p>Recovered</p>',
        text: 'Recovered',
        sourceMessageId: 'retry-source-id',
      },
      auth
    )
    const retry = await retryResponse.json()

    expect(firstResponse.status).toBe(201)
    expect(retryResponse.status).toBe(201)
    expect(retry.draft).toEqual(expect.objectContaining({
      id: first.draft.id,
      subject: 'Recovered title',
      sourceMessageId: 'retry-source-id',
    }))
    expect(db.newsletterDrafts.size).toBe(1)

    const getResponse = await getJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts/${first.draft.id}`,
      auth
    )
    await expect(getResponse.json()).resolves.toEqual(expect.objectContaining({
      draft: expect.objectContaining({ subject: 'Recovered title' }),
      html: '<p>Recovered</p>',
      text: 'Recovered',
    }))
  })

  it('keeps child content packaged when trashing a newsletter', async () => {
    const { env, db } = createEnv()
    const createResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts`,
      {
        subject: 'Delete with newsletter',
        html: '<p>Draft</p>',
        text: 'Draft',
        sourceMessageId: 'delete-source-id',
      },
      auth
    )
    expect(createResponse.status).toBe(201)
    expect(db.newsletterDrafts.size).toBe(1)

    const deleteResponse = await deleteJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}`,
      auth
    )

    expect(deleteResponse.status).toBe(200)
    await expect(deleteResponse.json()).resolves.toEqual({
      message: 'Newsletter moved to Trash successfully',
    })
    expect(db.newsletterDrafts.size).toBe(1)
    expect(db.newsletters.get(NEWSLETTER_ID)?.deletedAt).toEqual(expect.any(String))
  })

  it('sends a draft with its stable sourceMessageId and hides it from active drafts', async () => {
    const { env, db, queueSend } = createEnv()
    db.subscribers.set(`${NEWSLETTER_ID}:first@example.com`, {
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })
    const createResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts`,
      {
        subject: 'Draft send',
        html: '<p>Draft body</p>',
        text: 'Draft body',
        sourceMessageId: 'draft-source-id',
      },
      auth
    )
    const created = await createResponse.json()

    const sendResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts/${created.draft.id}/send`,
      {},
      auth
    )
    const sent = await sendResponse.json()

    expect(sendResponse.status).toBe(200)
    expect(sent).toEqual(expect.objectContaining({
      newsletterId: NEWSLETTER_ID,
      subject: 'Draft send',
      sendId: expect.any(String),
      duplicate: false,
    }))
    expect(db.newsletterSends.get(sent.sendId)).toEqual(expect.objectContaining({
      sourceMessageId: 'draft-source-id',
    }))
    expect(db.newsletterDrafts.get(created.draft.id)).toEqual(expect.objectContaining({
      status: 'sent',
      sendId: sent.sendId,
    }))
    expect(queueSend).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'fanout',
      sourceMessageId: 'draft-source-id',
    }))

    const listResponse = await getJson(env, `/api/newsletter/${NEWSLETTER_ID}/drafts`, auth)
    await expect(listResponse.json()).resolves.toEqual({ drafts: [] })
  })

  it('publishes the supplied draft snapshot instead of rereading stale stored content', async () => {
    const { env, db } = createEnv()
    db.subscribers.set(`${NEWSLETTER_ID}:first@example.com`, {
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })
    const createResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts`,
      {
        subject: 'Stale draft',
        html: '<p>Stale Ω body</p>',
        text: 'Stale Ω body',
        sourceMessageId: 'snapshot-source-id',
      },
      auth
    )
    const created = await createResponse.json()

    const sendResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts/${created.draft.id}/send`,
      {
        subject: 'Clean send',
        html: '<p>Clean body</p>',
        text: 'Clean body',
        sourceMessageId: 'snapshot-source-id',
      },
      auth
    )
    const sent = await sendResponse.json() as {
      fileName: string
      textFileName: string
      sendId: string
    }
    const sentHtml = await env.R2.get(sent.fileName)
    const sentText = await env.R2.get(sent.textFileName)

    expect(sendResponse.status).toBe(200)
    await expect(sentHtml?.text()).resolves.toContain(
      '<!-- letterdrop-content-start --><p>Clean body</p><!-- letterdrop-content-end -->'
    )
    await expect(sentText?.text()).resolves.toBe('Clean body')
    expect(db.newsletterSends.get(sent.sendId)).toEqual(expect.objectContaining({
      subject: 'Clean send',
      sourceMessageId: 'snapshot-source-id',
    }))
    expect(db.newsletterDrafts.get(created.draft.id)).toEqual(expect.objectContaining({
      status: 'sent',
      sendId: sent.sendId,
    }))
  })

  it('marks a draft sent when its sourceMessageId is already a send duplicate', async () => {
    const { env, db } = createEnv()
    db.newsletterSends.set('existing-send', {
      id: 'existing-send',
      newsletterId: NEWSLETTER_ID,
      subject: 'Already sent',
      sourceMessageId: 'duplicate-source',
      status: 'completed',
      recipientCount: 1,
      queuedCount: 1,
      fanoutQueuedCount: 1,
      sendingCount: 0,
      retryingCount: 0,
      queueFailedCount: 0,
      providerAcceptedCount: 0,
      deliveredCount: 1,
      deliveryDelayedCount: 0,
      bouncedCount: 0,
      complainedCount: 0,
      failedCount: 0,
      deadLetteredCount: 0,
      needsReviewCount: 0,
      lastError: null,
      contentFileName: 'newsletters/duplicate.html',
      textFileName: 'newsletters/duplicate.txt',
      fromName: null,
      footerHtml: null,
      footerText: null,
      fanoutSnapshotAt: '2026-04-30T01:00:00Z',
      fanoutCursorEmail: null,
      fanoutCompletedAt: '2026-04-30T01:00:00Z',
      createdAt: '2026-04-30T01:00:00Z',
      updatedAt: '2026-04-30T01:00:00Z',
      completedAt: '2026-04-30T01:00:00Z',
    })
    const createResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts`,
      {
        subject: 'Draft duplicate',
        html: '<p>Draft body</p>',
        text: 'Draft body',
        sourceMessageId: 'duplicate-source',
      },
      auth
    )
    const created = await createResponse.json()

    const sendResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts/${created.draft.id}/send`,
      {},
      auth
    )
    const sent = await sendResponse.json()

    expect(sendResponse.status).toBe(200)
    expect(sent).toEqual(expect.objectContaining({
      sendId: 'existing-send',
      duplicate: true,
    }))
    expect(db.newsletterDrafts.get(created.draft.id)).toEqual(expect.objectContaining({
      status: 'sent',
      sendId: 'existing-send',
    }))
  })

  it('returns sent content and creates template drafts with a fresh sourceMessageId', async () => {
    const { env } = createEnv()
    const publishResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      TRACKED_PUBLISH_PAYLOAD,
      auth
    )
    const published = await publishResponse.json()

    const contentResponse = await getJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/sends/${published.sendId}/content`,
      auth
    )
    const content = await contentResponse.json()
    expect(content).toEqual(expect.objectContaining({
      send: expect.objectContaining({ id: published.sendId }),
      text: TRACKED_PUBLISH_PAYLOAD.text,
    }))
    expect(String(content.html)).toContain(TRACKED_PUBLISH_PAYLOAD.html)
    expect(String(content.html)).toContain('letterdrop-global-email-styles')

    const templateResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/sends/${published.sendId}/draft`,
      {},
      auth
    )
    const template = await templateResponse.json()

    expect(templateResponse.status).toBe(201)
    expect(template).toEqual(expect.objectContaining({
      draft: expect.objectContaining({
        subject: TRACKED_PUBLISH_PAYLOAD.subject,
        sourceMessageId: expect.stringMatching(/^draft:/),
      }),
      html: TRACKED_PUBLISH_PAYLOAD.html,
      text: TRACKED_PUBLISH_PAYLOAD.text,
    }))
    expect(String(template.html)).not.toContain('letterdrop-global-email-styles')
    expect(template.draft.sourceMessageId).not.toBe(TRACKED_PUBLISH_PAYLOAD.sourceMessageId)
  })

  it('reports unavailable sent content and enforces newsletter scoping', async () => {
    const { env } = createEnv()
    const publishResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      TRACKED_PUBLISH_PAYLOAD,
      auth
    )
    const published = await publishResponse.json()

    const scopedResponse = await getJson(
      env,
      `/api/newsletter/${SECOND_NEWSLETTER_ID}/sends/${published.sendId}/content`,
      auth
    )
    expect(scopedResponse.status).toBe(404)

    await env.R2.delete(published.fileName)
    const missingContentResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/sends/${published.sendId}/draft`,
      {},
      auth
    )

    expect(missingContentResponse.status).toBe(404)
    await expect(missingContentResponse.json()).resolves.toEqual({
      error: 'Newsletter send content not found',
    })
  })
})

describe('scheduled newsletter sends', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  const auth = { Authorization: 'Bearer admin-token' }

  it('validates source identity, content, and future whole-minute timestamps', async () => {
    const { env, db } = createEnv()
    const createResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts`,
      {
        subject: 'Schedule validation',
        html: '<p>Body</p>',
        text: 'Body',
        sourceMessageId: 'schedule-validation-source',
      },
      auth
    )
    const created = await createResponse.json() as {
      draft: { id: string; sourceMessageId: string }
    }
    const schedulePath = `/api/newsletter/${NEWSLETTER_ID}/drafts/${created.draft.id}/schedule`
    const validBody = {
      subject: 'Schedule validation',
      html: '<p>Body</p>',
      text: 'Body',
      sourceMessageId: created.draft.sourceMessageId,
      scheduledAt: futureWholeMinute(),
    }
    const pastWholeMinute = new Date(
      (Math.floor(Date.now() / 60_000) - 1) * 60_000
    ).toISOString()
    const futureWithSeconds = new Date(
      Date.parse(futureWholeMinute()) + 1_000
    ).toISOString()
    const cases = [
      {
        body: { ...validBody, sourceMessageId: '' },
        status: 400,
        error: 'sourceMessageId is required',
      },
      {
        body: { ...validBody, sourceMessageId: 'another-source' },
        status: 409,
        error: 'sourceMessageId does not match the draft',
      },
      {
        body: { ...validBody, scheduledAt: 'not-a-date' },
        status: 400,
        error: 'scheduledAt must be a valid ISO-8601 timestamp',
      },
      {
        body: { ...validBody, scheduledAt: 'July 21, 2026 12:00 PM' },
        status: 400,
        error: 'scheduledAt must be a valid ISO-8601 timestamp',
      },
      {
        body: { ...validBody, scheduledAt: futureWithSeconds },
        status: 400,
        error: 'scheduledAt must use whole-minute precision',
      },
      {
        body: { ...validBody, scheduledAt: pastWholeMinute },
        status: 400,
        error: 'scheduledAt must be in the future',
      },
      {
        body: { ...validBody, html: '' },
        status: 400,
        error: 'Email html and text are required',
      },
    ]

    for (const testCase of cases) {
      const response = await postJson(env, schedulePath, testCase.body, auth)
      expect(response.status).toBe(testCase.status)
      await expect(response.json()).resolves.toEqual({ error: testCase.error })
    }
    expect(db.newsletterDrafts.get(created.draft.id)?.status).toBe('draft')
  })

  it('does not create a hidden schedule when newsletter deletion wins the write race', async () => {
    const { env, db, r2Objects } = createEnv()
    const createResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts`,
      {
        subject: 'Deletion race',
        html: '<p>Original body</p>',
        text: 'Original body',
        sourceMessageId: 'schedule-deletion-race-source',
      },
      auth
    )
    const created = await createResponse.json() as {
      draft: {
        id: string
        contentFileName: string
        textFileName: string
        sourceMessageId: string
      }
    }
    const originalKeys = Array.from(r2Objects.keys()).sort()
    const originalHtml = r2Objects.get(created.draft.contentFileName)
    const originalText = r2Objects.get(created.draft.textFileName)
    db.beforeNextScheduleWrite(() => {
      const newsletter = db.newsletters.get(NEWSLETTER_ID)
      if (newsletter) newsletter.deletedAt = new Date().toISOString()
    })

    const response = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts/${created.draft.id}/schedule`,
      {
        subject: 'Deletion race',
        html: '<p>Scheduled body</p>',
        text: 'Scheduled body',
        sourceMessageId: created.draft.sourceMessageId,
        scheduledAt: futureWholeMinute(),
      },
      auth
    )

    expect(response.status).toBe(409)
    expect(db.newsletterDrafts.get(created.draft.id)).toEqual(expect.objectContaining({
      status: 'draft',
      contentFileName: created.draft.contentFileName,
      textFileName: created.draft.textFileName,
      scheduledAt: null,
    }))
    expect(r2Objects.get(created.draft.contentFileName)).toBe(originalHtml)
    expect(r2Objects.get(created.draft.textFileName)).toBe(originalText)
    expect(Array.from(r2Objects.keys()).sort()).toEqual(originalKeys)
  })

  it('keeps editable and delivery snapshots intact when dispatch claims an edit race', async () => {
    const { env, db, r2Objects } = createEnv()
    const fixture = await createScheduledDraft(env, {
      sourceMessageId: 'scheduled-edit-claim-race-source',
    })
    const draftId = fixture.created.draft.id
    const draft = db.newsletterDrafts.get(draftId)
    if (!draft?.scheduledContentFileName || !draft.scheduledTextFileName) {
      throw new Error('Expected scheduled draft snapshots')
    }
    const originalPointers = {
      contentFileName: draft.contentFileName,
      textFileName: draft.textFileName,
      scheduledContentFileName: draft.scheduledContentFileName,
      scheduledTextFileName: draft.scheduledTextFileName,
    }
    const originalContents = new Map(
      Object.values(originalPointers).map((key) => [key, r2Objects.get(key)])
    )
    const originalKeys = Array.from(r2Objects.keys()).sort()
    db.beforeNextScheduleWrite(() => {
      draft.status = 'dispatching'
      draft.scheduleClaimedAt = new Date().toISOString()
    })

    const response = await putJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts/${draftId}`,
      {
        subject: 'Too late to edit',
        html: '<p>Too late to edit</p>',
        text: 'Too late to edit',
      },
      auth
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Delivery has already started. Refresh Send Activity to see the current status.',
    })
    expect(db.newsletterDrafts.get(draftId)).toEqual(expect.objectContaining({
      status: 'dispatching',
      ...originalPointers,
    }))
    for (const [key, content] of originalContents) {
      expect(r2Objects.get(key)).toBe(content)
    }
    expect(Array.from(r2Objects.keys()).sort()).toEqual(originalKeys)
  })

  it('stores versioned snapshots, freezes configuration, edits, reschedules, lists, and cancels', async () => {
    const { env, db, kv, r2Objects } = createEnv()
    const capturedStyle = factoryEmailStyleConfig()
    capturedStyle.body.fontSizePx = 17
    const capturedFooter = {
      html: `<p>Captured <a href="${UNSUBSCRIBE_PLACEHOLDER_URL}">unsubscribe</a></p>`,
      text: `Captured unsubscribe: ${UNSUBSCRIBE_PLACEHOLDER_URL}`,
    }
    await kv.put('publish-config', JSON.stringify({ fromName: 'Captured Sender' }))
    await kv.put('unsubscribe-footer-config', JSON.stringify(capturedFooter))
    await kv.put('email-style-config-v1', JSON.stringify(capturedStyle))

    const fixture = await createScheduledDraft(env, {
      sourceMessageId: 'snapshot-schedule-source',
    })
    const draftId = fixture.created.draft.id
    const initial = db.newsletterDrafts.get(draftId)
    const firstEditableHtml = initial?.contentFileName
    const firstEditableText = initial?.textFileName
    const firstSnapshot = initial?.scheduledContentFileName
    expect(initial).toEqual(expect.objectContaining({
      status: 'scheduled',
      scheduledFromName: 'Captured Sender',
      scheduledFooterHtml: capturedFooter.html,
      scheduledFooterText: capturedFooter.text,
      scheduledEmailStyleConfig: JSON.stringify(capturedStyle),
      scheduleAttemptCount: 0,
      scheduleLastError: null,
    }))
    expect(firstSnapshot).toMatch(
      new RegExp(`^newsletters/${NEWSLETTER_ID}/scheduled/${draftId}/.+\\.html$`)
    )
    expect(firstEditableHtml).toMatch(
      new RegExp(`^newsletters/${NEWSLETTER_ID}/drafts/${draftId}/.+\\.html$`)
    )
    expect(r2Objects.get(String(firstSnapshot))).toContain('font-size: 17px')

    const changedStyle = factoryEmailStyleConfig()
    changedStyle.body.fontSizePx = 31
    await kv.put('publish-config', JSON.stringify({ fromName: 'New Sender' }))
    await kv.put('unsubscribe-footer-config', JSON.stringify({
      html: `<p>New <a href="${UNSUBSCRIBE_PLACEHOLDER_URL}">unsubscribe</a></p>`,
      text: `New unsubscribe: ${UNSUBSCRIBE_PLACEHOLDER_URL}`,
    }))
    await kv.put('email-style-config-v1', JSON.stringify(changedStyle))

    const rescheduledAt = futureWholeMinute(20)
    const rescheduleResponse = await patchJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/scheduled-sends/${draftId}`,
      { scheduledAt: rescheduledAt },
      auth
    )
    expect(rescheduleResponse.status).toBe(200)
    expect(db.newsletterDrafts.get(draftId)).toEqual(expect.objectContaining({
      scheduledAt: rescheduledAt,
      scheduledContentFileName: firstSnapshot,
      scheduledFromName: 'Captured Sender',
      scheduledEmailStyleConfig: JSON.stringify(capturedStyle),
    }))

    const updateResponse = await putJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts/${draftId}`,
      {
        subject: 'Edited scheduled title',
        html: '<p>Edited scheduled body</p>',
        text: 'Edited scheduled body',
      },
      auth
    )
    const updated = await updateResponse.json() as {
      draft: { scheduledAt: string; scheduleLastError: string | null }
    }
    const editedRecord = db.newsletterDrafts.get(draftId)
    const secondEditableHtml = editedRecord?.contentFileName
    const secondSnapshot = editedRecord?.scheduledContentFileName
    expect(updateResponse.status).toBe(200)
    expect(updated.draft).toEqual(expect.objectContaining({
      scheduledAt: rescheduledAt,
      scheduleLastError: null,
    }))
    expect(secondSnapshot).not.toBe(firstSnapshot)
    expect(secondEditableHtml).not.toBe(firstEditableHtml)
    expect(r2Objects.has(String(firstEditableHtml))).toBe(false)
    expect(r2Objects.has(String(firstEditableText))).toBe(false)
    expect(r2Objects.has(String(firstSnapshot))).toBe(false)
    expect(r2Objects.get(String(secondSnapshot))).toContain('font-size: 17px')
    expect(r2Objects.get(String(secondSnapshot))).not.toContain('font-size: 31px')
    expect(r2Objects.get(String(editedRecord?.contentFileName))).toBe(
      '<p>Edited scheduled body</p>'
    )

    const listResponse = await getJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/scheduled-sends`,
      auth
    )
    await expect(listResponse.json()).resolves.toEqual({
      scheduledSends: [expect.objectContaining({
        draftId,
        subject: 'Edited scheduled title',
        state: 'scheduled',
        scheduledAt: rescheduledAt,
        attemptCount: 0,
        lastError: null,
      })],
    })

    const cancelResponse = await deleteJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/scheduled-sends/${draftId}`,
      auth
    )
    const canceled = await cancelResponse.json()
    expect(cancelResponse.status).toBe(200)
    expect(canceled).toEqual(expect.objectContaining({
      draft: expect.objectContaining({ status: 'draft', scheduledAt: null }),
      html: '<p>Edited scheduled body</p>',
      text: 'Edited scheduled body',
    }))
    expect(db.newsletterDrafts.get(draftId)).toEqual(expect.objectContaining({
      status: 'draft',
      scheduledAt: null,
      scheduledContentFileName: null,
      scheduledEmailStyleConfig: null,
    }))
    expect(r2Objects.has(String(secondSnapshot))).toBe(false)
    expect(r2Objects.has(String(editedRecord?.contentFileName))).toBe(true)
  })

  it('Send Now bypasses future backoff and resolves subscribers at dispatch time', async () => {
    const { env, db, queueSend, queueSendBatch } = createEnv()
    db.subscribers.set(`${NEWSLETTER_ID}:removed@example.com`, {
      email: 'removed@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })
    const fixture = await createScheduledDraft(env, {
      sourceMessageId: 'send-now-schedule-source',
    })
    const draftId = fixture.created.draft.id
    const draft = db.newsletterDrafts.get(draftId)
    if (!draft) throw new Error('Expected scheduled draft')
    draft.scheduleNextAttemptAt = futureWholeMinute(1_000)
    const removed = db.subscribers.get(`${NEWSLETTER_ID}:removed@example.com`)
    if (!removed) throw new Error('Expected original subscriber')
    removed.isSubscribed = 0
    db.subscribers.set(`${NEWSLETTER_ID}:added@example.com`, {
      email: 'added@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })

    const response = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/scheduled-sends/${draftId}/send-now`,
      {},
      auth
    )
    const result = await response.json() as { sendId: string; recipientCount: number }
    expect(response.status).toBe(200)
    expect(result.recipientCount).toBe(1)
    expect(db.newsletterDrafts.get(draftId)).toEqual(expect.objectContaining({
      status: 'sent',
      sendId: result.sendId,
    }))
    expect(db.newsletterSends.get(result.sendId)).toEqual(expect.objectContaining({
      recipientCount: 1,
      scheduledAt: fixture.scheduledAt,
      sourceMessageId: 'send-now-schedule-source',
    }))
    const recipientMessages = await drainFirstFanoutJob(env, queueSend, queueSendBatch)
    expect(recipientMessages).toHaveLength(1)
    expect(recipientEntriesFromQueueBody(recipientMessages[0])).toEqual([
      expect.objectContaining({ email: 'added@example.com' }),
    ])
  })

  it('cron claims once across overlapping runs and recovers stale claims', async () => {
    const { env, db, queueSend } = createEnv()
    const first = await createScheduledDraft(env, {
      sourceMessageId: 'overlapping-cron-source',
    })
    const firstDraft = db.newsletterDrafts.get(first.created.draft.id)
    if (!firstDraft) throw new Error('Expected first scheduled draft')
    firstDraft.scheduleNextAttemptAt = new Date(Date.now() - 60_000).toISOString()

    await Promise.all([
      runScheduledHandler(env),
      runScheduledHandler(env),
    ])

    expect(db.newsletterSends.size).toBe(1)
    expect(firstDraft.status).toBe('sent')
    expect(firstDraft.scheduleAttemptCount).toBe(1)
    expect(queueSend).toHaveBeenCalledTimes(1)

    const stale = await createScheduledDraft(env, {
      sourceMessageId: 'stale-cron-source',
    })
    const staleDraft = db.newsletterDrafts.get(stale.created.draft.id)
    if (!staleDraft) throw new Error('Expected stale scheduled draft')
    staleDraft.status = 'dispatching'
    staleDraft.scheduleClaimedAt = new Date(Date.now() - 10 * 60_000).toISOString()
    staleDraft.scheduleLastAttemptAt = staleDraft.scheduleClaimedAt
    staleDraft.scheduleAttemptCount = 1

    await runScheduledHandler(env)

    expect(staleDraft.status).toBe('sent')
    expect(staleDraft.scheduleAttemptCount).toBe(2)
    expect(db.newsletterSends.size).toBe(2)
    expect(queueSend).toHaveBeenCalledTimes(2)
  })

  it('retries enqueue failures at 1, 2, 5, 10, then 15 minutes indefinitely', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { env, db, queueSend } = createEnv({ failQueueSendCount: 6 })
    const fixture = await createScheduledDraft(env, {
      sourceMessageId: 'retry-schedule-source',
    })
    const draft = db.newsletterDrafts.get(fixture.created.draft.id)
    if (!draft) throw new Error('Expected retry scheduled draft')
    const expectedDelays = [1, 2, 5, 10, 15, 15]

    for (const [index, expectedDelay] of expectedDelays.entries()) {
      draft.scheduleNextAttemptAt = new Date(Date.now() - 60_000).toISOString()
      await runScheduledHandler(env)
      expect(draft.status).toBe('scheduled')
      expect(draft.scheduleAttemptCount).toBe(index + 1)
      expect(draft.scheduleLastError).toContain('Simulated queue send failure')
      const retryDelayMinutes = Math.round(
        (Date.parse(String(draft.scheduleNextAttemptAt)) - Date.parse(draft.updatedAt)) / 60_000
      )
      expect(retryDelayMinutes).toBe(expectedDelay)
    }

    expect(db.newsletterSends.size).toBe(1)
    draft.scheduleNextAttemptAt = new Date(Date.now() - 60_000).toISOString()
    await runScheduledHandler(env)
    expect(draft.status).toBe('sent')
    expect(draft.scheduleAttemptCount).toBe(7)
    expect(db.newsletterSends.size).toBe(1)
    expect(queueSend).toHaveBeenCalledTimes(7)
    expect(consoleError).toHaveBeenCalled()
  })

  it('completes a zero-recipient cron send through the normal fanout pipeline', async () => {
    const { env, db, queueSend, queueSendBatch } = createEnv()
    const fixture = await createScheduledDraft(env, {
      sourceMessageId: 'zero-recipient-schedule-source',
    })
    const draft = db.newsletterDrafts.get(fixture.created.draft.id)
    if (!draft) throw new Error('Expected zero-recipient scheduled draft')
    draft.scheduleNextAttemptAt = new Date(Date.now() - 60_000).toISOString()

    await runScheduledHandler(env)

    expect(draft.status).toBe('sent')
    const send = Array.from(db.newsletterSends.values())[0]
    expect(send).toEqual(expect.objectContaining({
      recipientCount: 0,
      status: 'queued',
      scheduledAt: fixture.scheduledAt,
    }))
    const fanoutBody = queueSend.mock.calls[0]?.[0] as Record<string, unknown>
    const fanout = createQueueBatch(fanoutBody)
    await worker.queue(fanout.batch, env)

    expect(fanout.message.retry).not.toHaveBeenCalled()
    expect(queueSendBatch).not.toHaveBeenCalled()
    expect(db.newsletterSends.get(send.id)).toEqual(expect.objectContaining({
      status: 'completed',
      fanoutCompletedAt: expect.any(String),
      completedAt: expect.any(String),
    }))
  })

  it('blocks deletion and returns 409 for every action after dispatch claims the row', async () => {
    const { env, db } = createEnv()
    const fixture = await createScheduledDraft(env, {
      sourceMessageId: 'claim-race-source',
    })
    const draftId = fixture.created.draft.id
    const scheduledDelete = await deleteJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}`,
      auth
    )
    expect(scheduledDelete.status).toBe(409)

    const draft = db.newsletterDrafts.get(draftId)
    if (!draft) throw new Error('Expected claimed scheduled draft')
    draft.status = 'dispatching'
    draft.scheduleClaimedAt = new Date().toISOString()
    const conflictMessage = {
      error: 'Delivery has already started. Refresh Send Activity to see the current status.',
    }
    const responses = [
      await putJson(
        env,
        `/api/newsletter/${NEWSLETTER_ID}/drafts/${draftId}`,
        { subject: 'Too late' },
        auth
      ),
      await postJson(
        env,
        `/api/newsletter/${NEWSLETTER_ID}/drafts/${draftId}/schedule`,
        {
          subject: 'Too late',
          html: '<p>Too late</p>',
          text: 'Too late',
          sourceMessageId: draft.sourceMessageId,
          scheduledAt: futureWholeMinute(30),
        },
        auth
      ),
      await patchJson(
        env,
        `/api/newsletter/${NEWSLETTER_ID}/scheduled-sends/${draftId}`,
        { scheduledAt: futureWholeMinute(30) },
        auth
      ),
      await deleteJson(
        env,
        `/api/newsletter/${NEWSLETTER_ID}/scheduled-sends/${draftId}`,
        auth
      ),
      await postJson(
        env,
        `/api/newsletter/${NEWSLETTER_ID}/scheduled-sends/${draftId}/send-now`,
        {},
        auth
      ),
    ]
    for (const response of responses) {
      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toEqual(conflictMessage)
    }
    const dispatchingDelete = await deleteJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}`,
      auth
    )
    expect(dispatchingDelete.status).toBe(409)
    await expect(dispatchingDelete.json()).resolves.toEqual({
      error: 'Cancel or send all scheduled messages before deleting this newsletter.',
    })
    expect(db.newsletters.get(NEWSLETTER_ID)?.deletedAt).toBeNull()
  })
})

describe('unified newsletter trash', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  const auth = { Authorization: 'Bearer admin-token' }

  it('lists historical subscribers and restores subscribers without resubscribing them', async () => {
    const { env, db } = createEnv()
    db.subscribers.set(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`, {
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
      firstName: 'Haben',
      lastName: 'Girma',
      isSubscribed: 0,
      upsertedAt: '2026-07-18T12:00:00.000Z',
      unsubscribedAt: '2026-07-18T12:00:00.000Z',
      deletedAt: '2026-07-18T12:00:00.000Z',
    })

    const listResponse = await getJson(env, '/api/newsletter/trash', auth)
    const list = await listResponse.json()

    expect(listResponse.status).toBe(200)
    expect(list).toEqual({
      items: [{
        kind: 'subscriber',
        id: SUBSCRIBER_EMAIL,
        newsletterId: NEWSLETTER_ID,
        title: 'Haben Girma',
        subtitle: `${SUBSCRIBER_EMAIL} • Subscriber in “Test Newsletter”`,
        deletedAt: '2026-07-18T12:00:00.000Z',
      }],
      pagination: { page: 1, limit: 50, total: 1 },
    })

    const restoreResponse = await postJson(
      env,
      `/api/newsletter/trash/newsletters/${NEWSLETTER_ID}/subscribers/${SUBSCRIBER_EMAIL}/restore`,
      {},
      auth
    )

    expect(restoreResponse.status).toBe(200)
    expect(db.subscribers.get(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`)).toEqual(
      expect.objectContaining({ isSubscribed: 0, deletedAt: null })
    )
    const repeatedRestore = await postJson(
      env,
      `/api/newsletter/trash/newsletters/${NEWSLETTER_ID}/subscribers/${SUBSCRIBER_EMAIL}/restore`,
      {},
      auth
    )
    expect(repeatedRestore.status).toBe(404)
  })

  it('restores and permanently deletes draft content through Trash', async () => {
    const { env, db, r2Delete } = createEnv()
    const createResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts`,
      { subject: 'Recoverable draft', html: '<p>Recover me</p>', text: 'Recover me' },
      auth
    )
    const created = await createResponse.json()
    await deleteJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts/${created.draft.id}`,
      auth
    )

    const restoreResponse = await postJson(
      env,
      `/api/newsletter/trash/newsletters/${NEWSLETTER_ID}/drafts/${created.draft.id}/restore`,
      {},
      auth
    )
    expect(restoreResponse.status).toBe(200)
    expect(db.newsletterDrafts.get(created.draft.id)?.deletedAt).toBeNull()

    await deleteJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts/${created.draft.id}`,
      auth
    )
    const purgeResponse = await deleteJson(
      env,
      `/api/newsletter/trash/newsletters/${NEWSLETTER_ID}/drafts/${created.draft.id}`,
      auth
    )

    expect(purgeResponse.status).toBe(200)
    expect(db.newsletterDrafts.has(created.draft.id)).toBe(false)
    expect(r2Delete).toHaveBeenCalledWith([
      created.draft.contentFileName,
      created.draft.textFileName,
    ])
  })

  it('packages children under a trashed newsletter and restores their prior states', async () => {
    const { env, db } = createEnv()
    db.subscribers.set(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`, {
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 0,
      deletedAt: '2026-07-17T12:00:00.000Z',
    })
    const createResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts`,
      { subject: 'Active child', html: '<p>Child</p>', text: 'Child' },
      auth
    )
    expect(createResponse.status).toBe(201)

    await deleteJson(env, `/api/newsletter/${NEWSLETTER_ID}`, auth)
    const packagedResponse = await getJson(env, '/api/newsletter/trash', auth)
    const packaged = await packagedResponse.json()
    expect(packaged.pagination.total).toBe(1)
    expect(packaged.items).toEqual([
      expect.objectContaining({ kind: 'newsletter', id: NEWSLETTER_ID }),
    ])
    const hiddenDrafts = await getJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts`,
      auth
    )
    expect(hiddenDrafts.status).toBe(404)

    const restoreResponse = await postJson(
      env,
      `/api/newsletter/trash/newsletters/${NEWSLETTER_ID}/restore`,
      {},
      auth
    )
    expect(restoreResponse.status).toBe(200)
    expect(db.newsletters.get(NEWSLETTER_ID)?.deletedAt).toBeNull()

    const restoredListResponse = await getJson(env, '/api/newsletter/trash', auth)
    const restoredList = await restoredListResponse.json()
    expect(restoredList.items).toEqual([
      expect.objectContaining({ kind: 'subscriber', id: SUBSCRIBER_EMAIL }),
    ])
  })

  it('empties every displayed item and cascades permanently deleted newsletters', async () => {
    const { env, db, r2Objects } = createEnv()
    db.subscribers.set(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`, {
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })
    const createResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts`,
      { subject: 'Packaged draft', html: '<p>Packaged</p>', text: 'Packaged' },
      auth
    )
    const created = await createResponse.json()
    await deleteJson(env, `/api/newsletter/${NEWSLETTER_ID}`, auth)

    const emptyResponse = await deleteJson(env, '/api/newsletter/trash', auth)

    expect(emptyResponse.status).toBe(200)
    await expect(emptyResponse.json()).resolves.toEqual({
      message: 'Trash emptied successfully',
      deleted: { newsletters: 1, subscribers: 0, drafts: 0 },
    })
    expect(db.newsletters.has(NEWSLETTER_ID)).toBe(false)
    expect(db.subscribers.size).toBe(0)
    expect(db.newsletterDrafts.size).toBe(0)
    expect(r2Objects.has(created.draft.contentFileName)).toBe(false)
    expect(r2Objects.has(created.draft.textFileName)).toBe(false)
  })

  it('does not purge newsletters or drafts that win a restore race', async () => {
    const newsletterFixture = createEnv()
    const newsletterDraftResponse = await postJson(
      newsletterFixture.env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts`,
      { subject: 'Keep with parent', html: '<p>Keep</p>', text: 'Keep' },
      auth
    )
    const newsletterDraft = (await newsletterDraftResponse.json()).draft
    await deleteJson(newsletterFixture.env, `/api/newsletter/${NEWSLETTER_ID}`, auth)
    newsletterFixture.db.beforeNextBatch(() => {
      const newsletter = newsletterFixture.db.newsletters.get(NEWSLETTER_ID)
      if (newsletter) newsletter.deletedAt = null
    })

    const newsletterPurge = await deleteJson(
      newsletterFixture.env,
      `/api/newsletter/trash/newsletters/${NEWSLETTER_ID}`,
      auth
    )

    expect(newsletterPurge.status).toBe(404)
    expect(newsletterFixture.db.newsletters.has(NEWSLETTER_ID)).toBe(true)
    expect(newsletterFixture.db.newsletterDrafts.has(newsletterDraft.id)).toBe(true)
    expect(newsletterFixture.r2Objects.has(newsletterDraft.contentFileName)).toBe(true)
    expect(newsletterFixture.db.trashPurgeJobs.size).toBe(0)

    const draftFixture = createEnv()
    const draftResponse = await postJson(
      draftFixture.env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts`,
      { subject: 'Restore race', html: '<p>Keep draft</p>', text: 'Keep draft' },
      auth
    )
    const draft = (await draftResponse.json()).draft
    await deleteJson(
      draftFixture.env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts/${draft.id}`,
      auth
    )
    draftFixture.db.beforeNextBatch(() => {
      const storedDraft = draftFixture.db.newsletterDrafts.get(draft.id)
      if (storedDraft) storedDraft.deletedAt = null
    })

    const draftPurge = await deleteJson(
      draftFixture.env,
      `/api/newsletter/trash/newsletters/${NEWSLETTER_ID}/drafts/${draft.id}`,
      auth
    )

    expect(draftPurge.status).toBe(404)
    expect(draftFixture.db.newsletterDrafts.has(draft.id)).toBe(true)
    expect(draftFixture.r2Objects.has(draft.contentFileName)).toBe(true)
    expect(draftFixture.db.trashPurgeJobs.size).toBe(0)
  })

  it('takes the Empty Trash snapshot inside the deletion batch', async () => {
    const { env, db, r2Objects } = createEnv()
    const packagedDraftResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts`,
      { subject: 'Restored parent draft', html: '<p>Parent</p>', text: 'Parent' },
      auth
    )
    const packagedDraft = (await packagedDraftResponse.json()).draft
    await deleteJson(env, `/api/newsletter/${NEWSLETTER_ID}`, auth)

    db.newsletters.set(SECOND_NEWSLETTER_ID, {
      id: SECOND_NEWSLETTER_ID,
      subscribable: 1,
      title: 'Second Newsletter',
      description: 'Second description',
      deletedAt: null,
    })
    const newlyTrashedDraftResponse = await postJson(
      env,
      `/api/newsletter/${SECOND_NEWSLETTER_ID}/drafts`,
      { subject: 'Newly trashed', html: '<p>New</p>', text: 'New' },
      auth
    )
    const newlyTrashedDraft = (await newlyTrashedDraftResponse.json()).draft
    db.beforeNextBatch(() => {
      const restoredNewsletter = db.newsletters.get(NEWSLETTER_ID)
      const newDraft = db.newsletterDrafts.get(newlyTrashedDraft.id)
      if (restoredNewsletter) restoredNewsletter.deletedAt = null
      if (newDraft) newDraft.deletedAt = '2026-07-19T23:00:00.000Z'
    })

    const response = await deleteJson(env, '/api/newsletter/trash', auth)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      message: 'Trash emptied successfully',
      deleted: { newsletters: 0, subscribers: 0, drafts: 1 },
    })
    expect(db.newsletters.has(NEWSLETTER_ID)).toBe(true)
    expect(db.newsletterDrafts.has(packagedDraft.id)).toBe(true)
    expect(r2Objects.has(packagedDraft.contentFileName)).toBe(true)
    expect(db.newsletterDrafts.has(newlyTrashedDraft.id)).toBe(false)
    expect(r2Objects.has(newlyTrashedDraft.contentFileName)).toBe(false)
  })

  it('retains failed R2 cleanup jobs and retries them idempotently', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { env, db, r2Objects } = createEnv({ failR2DeleteOnce: true })
    const createResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/drafts`,
      { subject: 'Retry cleanup', html: '<p>Retry</p>', text: 'Retry' },
      auth
    )
    const draft = (await createResponse.json()).draft
    await deleteJson(env, `/api/newsletter/${NEWSLETTER_ID}/drafts/${draft.id}`, auth)

    const failedPurge = await deleteJson(
      env,
      `/api/newsletter/trash/newsletters/${NEWSLETTER_ID}/drafts/${draft.id}`,
      auth
    )

    expect(failedPurge.status).toBe(500)
    expect(db.newsletterDrafts.has(draft.id)).toBe(false)
    expect(db.trashPurgeJobs.size).toBe(1)
    expect(r2Objects.has(draft.contentFileName)).toBe(true)

    const retriedPurge = await deleteJson(
      env,
      `/api/newsletter/trash/newsletters/${NEWSLETTER_ID}/drafts/${draft.id}`,
      auth
    )

    expect(retriedPurge.status).toBe(200)
    expect(db.trashPurgeJobs.size).toBe(0)
    expect(r2Objects.has(draft.contentFileName)).toBe(false)
    expect(consoleError).toHaveBeenCalled()
  })

  it('returns not found when changing the online state of a trashed newsletter', async () => {
    const { env, db } = createEnv()
    await deleteJson(env, `/api/newsletter/${NEWSLETTER_ID}`, auth)

    const offline = await putJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/offline`,
      {},
      auth
    )
    const online = await putJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/online`,
      {},
      auth
    )

    expect(offline.status).toBe(404)
    expect(online.status).toBe(404)
    expect(db.newsletters.get(NEWSLETTER_ID)?.subscribable).toBe(1)
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
    const storedHtml = String(
      r2Put.mock.calls.find(([key]) => key === result.fileName)?.[1]
    )
    expect(storedHtml).toContain('letterdrop-global-email-styles')
    expect(storedHtml).toContain('<!-- letterdrop-content-start --><h1>Hello subscribers</h1>')
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
    expect(String(html)).toContain('letterdrop-global-email-styles')
    expect(String(html)).toContain('<h1>Hello subscribers</h1>')
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
      queueSend,
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

  it('renders the snapshotted rich footer with the recipient unsubscribe URL', async () => {
    const { env, notificationFetch } = createEnv()
    const fileName = `newsletters/${NEWSLETTER_ID}/custom-footer.html`
    const textFileName = `newsletters/${NEWSLETTER_ID}/custom-footer.txt`
    await env.R2.put(fileName, '<html><body><h1>Hello</h1></body></html>')
    await env.R2.put(textFileName, 'Plain text body')
    const footerHtml = `<p><strong>Thanks.</strong> <a href="https://example.com/privacy">Privacy</a> <a href="${UNSUBSCRIBE_PLACEHOLDER_URL}">Leave this list</a></p>`
    const footerText = `Thanks. Privacy Leave this list: ${UNSUBSCRIBE_PLACEHOLDER_URL}`
    const { batch, message } = createQueueBatch({
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      subject: 'Custom footer test',
      fileName,
      textFileName,
      footerHtml,
      footerText,
    })

    await worker.queue(batch, env)

    expect(message.retry).not.toHaveBeenCalled()
    const body = await getNotificationRequestBody(notificationFetch)
    expect(String(body.html)).toContain('<strong>Thanks.</strong>')
    expect(String(body.html)).toContain('href="https://example.com/privacy"')
    expect(String(body.html)).toContain('>Leave this list</a>')
    expect(String(body.txt)).toContain('Leave this list: https://newsletter.example.com/api/subscribe/unsubscribe/')
    expect(String(body.html)).not.toContain(UNSUBSCRIBE_PLACEHOLDER_URL)
    expect(String(body.txt)).not.toContain(UNSUBSCRIBE_PLACEHOLDER_URL)
  })

  it('snapshots footer configuration for each send without copying it into queue messages', async () => {
    const { env, db, notificationFetch, queueSend, queueSendBatch } = createEnv()
    db.subscribers.set(`${NEWSLETTER_ID}:first@example.com`, {
      email: 'first@example.com',
      newsletterId: NEWSLETTER_ID,
      firstName: null,
      lastName: null,
      isSubscribed: 1,
    })
    const firstFooter = {
      html: `<p>First <a href="${UNSUBSCRIBE_PLACEHOLDER_URL}">Leave</a></p>`,
      text: `First Leave: ${UNSUBSCRIBE_PLACEHOLDER_URL}`,
    }
    const secondFooter = {
      html: `<p>Second <a href="${UNSUBSCRIBE_PLACEHOLDER_URL}">Stop</a></p>`,
      text: `Second Stop: ${UNSUBSCRIBE_PLACEHOLDER_URL}`,
    }
    await putJson(
      env,
      '/api/newsletter/footer-config',
      firstFooter,
      { Authorization: 'Bearer admin-token' }
    )
    const firstResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      { ...TRACKED_PUBLISH_PAYLOAD, sourceMessageId: 'first-footer-send' },
      { Authorization: 'Bearer admin-token' }
    )
    expect(firstResponse.status).toBe(200)
    const firstFanout = queueSend.mock.calls.at(-1)?.[0] as Record<string, unknown>

    await putJson(
      env,
      '/api/newsletter/footer-config',
      secondFooter,
      { Authorization: 'Bearer admin-token' }
    )
    const firstFanoutBatch = createQueueBatch(firstFanout)
    await worker.queue(firstFanoutBatch.batch, env)
    const firstRecipientBatch = (
      queueSendBatch.mock.calls.at(-1)?.[0] as Array<{ body: Record<string, unknown> }>
    )[0].body
    await worker.queue(createQueueBatch(firstRecipientBatch).batch, env)
    const firstDelivery = await getNotificationRequestBody(notificationFetch)

    const secondResponse = await postJson(
      env,
      `/api/newsletter/${NEWSLETTER_ID}/publish`,
      { ...TRACKED_PUBLISH_PAYLOAD, sourceMessageId: 'second-footer-send' },
      { Authorization: 'Bearer admin-token' }
    )
    expect(secondResponse.status).toBe(200)
    const secondFanout = queueSend.mock.calls.at(-1)?.[0] as Record<string, unknown>
    await worker.queue(createQueueBatch(secondFanout).batch, env)
    const secondRecipientBatch = (
      queueSendBatch.mock.calls.at(-1)?.[0] as Array<{ body: Record<string, unknown> }>
    )[0].body
    await worker.queue(createQueueBatch(secondRecipientBatch).batch, env)
    const secondDelivery = await getNotificationRequestBody(notificationFetch)

    expect(firstFanout).not.toHaveProperty('footerHtml')
    expect(firstFanout).not.toHaveProperty('footerText')
    expect(firstRecipientBatch).not.toHaveProperty('footerHtml')
    expect(firstRecipientBatch).not.toHaveProperty('footerText')
    expect(String(firstDelivery.html)).toContain('First')
    expect(String(firstDelivery.html)).toContain('>Leave</a>')
    expect(secondFanout).not.toHaveProperty('footerHtml')
    expect(secondFanout).not.toHaveProperty('footerText')
    expect(secondRecipientBatch).not.toHaveProperty('footerHtml')
    expect(secondRecipientBatch).not.toHaveProperty('footerText')
    expect(String(secondDelivery.html)).toContain('Second')
    expect(String(secondDelivery.html)).toContain('>Stop</a>')
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
    const expectedIdempotencyKey = `newsletter:${sendId}:${firstRecipientHashFromQueueBody(queueBody)}`
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

  it('sends every recipient in a recipient batch and updates tracking', async () => {
    const { env, db, notificationFetch, queueSend, queueSendBatch, r2Get } = createEnv()
    for (const email of ['first@example.com', 'second@example.com']) {
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
      TRACKED_PUBLISH_PAYLOAD,
      { Authorization: 'Bearer admin-token' }
    )
    const result = await response.json() as { sendId: string }
    const [queueBody] = await drainFirstFanoutJob(env, queueSend, queueSendBatch)
    const { batch, message } = createQueueBatch(queueBody)
    notificationFetch.mockClear()

    await worker.queue(batch, env)

    expect(message.retry).not.toHaveBeenCalled()
    expect(notificationFetch).toHaveBeenCalledTimes(2)
    expect(r2Get).toHaveBeenCalledTimes(2)
    expect(r2Get.mock.calls.map(([key]) => key)).toEqual([
      expect.stringMatching(/\.html$/),
      expect.stringMatching(/\.txt$/),
    ])
    expect(Array.from(db.newsletterSendRecipients.values()).map((recipient) => (
      recipient.status
    ))).toEqual(['providerAccepted', 'providerAccepted'])
    expect(db.newsletterSends.get(result.sendId)).toEqual(expect.objectContaining({
      queuedCount: 0,
      providerAcceptedCount: 2,
    }))
  })

  it('requeues retryable recipient batch failures and resumes unsent recipients', async () => {
    const { env, db, notificationFetch, queueSend, queueSendBatch } = createEnv()
    for (const email of ['first@example.com', 'second@example.com', 'third@example.com']) {
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
      TRACKED_PUBLISH_PAYLOAD,
      { Authorization: 'Bearer admin-token' }
    )
    const result = await response.json() as { sendId: string }
    const [queueBody] = await drainFirstFanoutJob(env, queueSend, queueSendBatch)
    const firstDelivery = createQueueBatch(queueBody)
    queueSend.mockClear()
    notificationFetch.mockClear()
    notificationFetch
      .mockResolvedValueOnce(notificationSuccessResponse('ses-first'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        message: 'error',
        detail: 'sender throttled',
        retryAfterSeconds: 1,
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }))

    await worker.queue(firstDelivery.batch, env)

    expect(firstDelivery.message.retry).not.toHaveBeenCalled()
    expect(notificationFetch).toHaveBeenCalledTimes(2)
    expect(queueSend).toHaveBeenCalledTimes(2)
    expect(queueSend.mock.calls.map((call) => call[1])).toEqual([
      { delaySeconds: 1 },
      { delaySeconds: 1 },
    ])
    expect(Array.from(db.newsletterSendRecipients.values()).map((recipient) => (
      recipient.status
    ))).toEqual(['providerAccepted', 'retrying', 'queued'])

    notificationFetch.mockClear()
    const retryBody = queueSend.mock.calls[0][0] as Record<string, unknown>
    const remainingBody = queueSend.mock.calls[1][0] as Record<string, unknown>
    const retryDelivery = createQueueBatch(retryBody)
    const remainingDelivery = createQueueBatch(remainingBody)
    await worker.queue(retryDelivery.batch, env)
    await worker.queue(remainingDelivery.batch, env)

    expect(retryDelivery.message.retry).not.toHaveBeenCalled()
    expect(remainingDelivery.message.retry).not.toHaveBeenCalled()
    expect(notificationFetch).toHaveBeenCalledTimes(2)
    expect(Array.from(db.newsletterSendRecipients.values()).map((recipient) => ({
      email: recipient.email,
      status: recipient.status,
      attempts: recipient.attempts,
    }))).toEqual([
      { email: 'first@example.com', status: 'providerAccepted', attempts: 1 },
      { email: 'second@example.com', status: 'providerAccepted', attempts: 2 },
      { email: 'third@example.com', status: 'providerAccepted', attempts: 1 },
    ])
    expect(db.newsletterSends.get(result.sendId)).toEqual(expect.objectContaining({
      queuedCount: 0,
      retryingCount: 0,
      providerAcceptedCount: 3,
    }))
  })

  it('isolates repeated batch failures so unrelated recipients do not share retry budget', async () => {
    const { env, db, notificationFetch, queueSend, queueSendBatch } = createEnv()
    for (const email of ['first@example.com', 'second@example.com', 'third@example.com']) {
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
      TRACKED_PUBLISH_PAYLOAD,
      { Authorization: 'Bearer admin-token' }
    )
    const result = await response.json() as { sendId: string }
    const [queueBody] = await drainFirstFanoutJob(env, queueSend, queueSendBatch)
    queueSend.mockClear()
    notificationFetch.mockClear()
    notificationFetch.mockResolvedValueOnce(new Response('sender throttled', { status: 429 }))

    const firstDelivery = createQueueBatch(queueBody)
    await worker.queue(firstDelivery.batch, env)

    expect(firstDelivery.message.retry).not.toHaveBeenCalled()
    expect(queueSend).toHaveBeenCalledTimes(2)
    expect(Array.from(db.newsletterSendRecipients.values()).map((recipient) => (
      recipient.status
    ))).toEqual(['retrying', 'queued', 'queued'])

    const remainingAfterFirstFailure = queueSend.mock.calls[1][0] as Record<string, unknown>
    queueSend.mockClear()
    notificationFetch.mockClear()
    notificationFetch.mockResolvedValueOnce(new Response('sender throttled', { status: 429 }))

    const secondDelivery = createQueueBatch(remainingAfterFirstFailure)
    await worker.queue(secondDelivery.batch, env)

    expect(secondDelivery.message.retry).not.toHaveBeenCalled()
    expect(queueSend).toHaveBeenCalledTimes(2)
    expect(Array.from(db.newsletterSendRecipients.values()).map((recipient) => (
      recipient.status
    ))).toEqual(['retrying', 'retrying', 'queued'])

    const isolatedSecondRetry = queueSend.mock.calls[0][0] as Record<string, unknown>
    const secondRetryDlq = createQueueBatch(isolatedSecondRetry, 'haben-letterdrop-dlq')
    await worker.queue(secondRetryDlq.batch, env)

    expect(Array.from(db.newsletterSendRecipients.values()).map((recipient) => ({
      email: recipient.email,
      status: recipient.status,
    }))).toEqual([
      { email: 'first@example.com', status: 'retrying' },
      { email: 'second@example.com', status: 'deadLettered' },
      { email: 'third@example.com', status: 'queued' },
    ])
    expect(db.newsletterSends.get(result.sendId)).toEqual(expect.objectContaining({
      deadLetteredCount: 1,
      retryingCount: 1,
      queuedCount: 1,
    }))
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
    const { env, db, notificationFetch, queueSend, queueBody, sendId } = await publishTrackedNewsletter()
    queueSend.mockClear()
    notificationFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      message: 'error',
      detail: 'sender throttled',
      retryAfterSeconds: 1,
    }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    }))
    const { batch, message } = createQueueBatch(queueBody)

    await worker.queue(batch, env)

    expect(message.retry).not.toHaveBeenCalled()
    expect(queueSend).toHaveBeenCalledTimes(1)
    expect(queueSend.mock.calls[0][0]).toEqual(expect.objectContaining({
      kind: 'recipientBatch',
      recipients: [expect.objectContaining({ email: 'first@example.com' })],
    }))
    expect(queueSend.mock.calls[0][1]).toEqual({ delaySeconds: 1 })
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

  it('retries when the notification rate limiter fails before SES contact', async () => {
    const { env, db, notificationFetch, queueSend, queueBody, sendId } = await publishTrackedNewsletter()
    queueSend.mockClear()
    notificationFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      message: 'error',
      detail: 'Email sender rate limiter unavailable',
      retryable: true,
      providerContacted: false,
      retryAfterSeconds: 5,
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    }))
    const { batch, message } = createQueueBatch(queueBody)

    await worker.queue(batch, env)

    expect(message.retry).not.toHaveBeenCalled()
    expect(queueSend).toHaveBeenCalledTimes(1)
    expect(queueSend.mock.calls[0][1]).toEqual({ delaySeconds: 5 })
    const recipient = Array.from(db.newsletterSendRecipients.values())[0]
    expect(recipient).toEqual(expect.objectContaining({
      status: 'retrying',
      attempts: 1,
      lastError: 'Notification service returned status 503',
    }))
    expect(db.newsletterSends.get(sendId)).toEqual(expect.objectContaining({
      status: 'sending',
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
            recipientHash: [firstRecipientHashFromQueueBody(queueBody)],
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
    const { env, db, notificationFetch, queueSend, queueBody, sendId } = await publishTrackedNewsletter()
    queueSend.mockClear()
    const { batch, message } = createQueueBatch({
      ...queueBody,
      fileName: `newsletters/${NEWSLETTER_ID}/missing.html`,
    })

    await worker.queue(batch, env)

    expect(notificationFetch).not.toHaveBeenCalled()
    expect(message.retry).not.toHaveBeenCalled()
    expect(queueSend).toHaveBeenCalledTimes(1)
    expect(queueSend.mock.calls[0][1]).toEqual({ delaySeconds: 60 })
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
    const { env, db, notificationFetch, queueSend, queueBody, sendId } = await publishTrackedNewsletter()
    queueSend.mockClear()
    env.NOTIFICATION_SHARED_SECRET = ''
    const { batch, message } = createQueueBatch(queueBody)

    await worker.queue(batch, env)

    expect(notificationFetch).not.toHaveBeenCalled()
    expect(message.retry).not.toHaveBeenCalled()
    expect(queueSend).toHaveBeenCalledTimes(1)
    expect(queueSend.mock.calls[0][1]).toEqual({ delaySeconds: 60 })
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
    const recipient = recipientEntriesFromQueueBody(queueBody)[0]
    const { batch } = createQueueBatch({
      kind: 'recipient',
      email: recipient.email,
      newsletterId: queueBody.newsletterId,
      subject: queueBody.subject,
      fileName: queueBody.fileName,
      textFileName: queueBody.textFileName,
      fromName: queueBody.fromName,
      sendId: queueBody.sendId,
      recipientHash: recipient.recipientHash,
    }, 'haben-letterdrop-dlq')

    await worker.queue(batch, env)

    expect(notificationFetch).not.toHaveBeenCalled()
    const trackedRecipient = Array.from(db.newsletterSendRecipients.values())[0]
    expect(trackedRecipient.status).toBe('deadLettered')
    expect(db.newsletterSends.get(sendId)).toEqual(expect.objectContaining({
      status: 'completedWithFailures',
      deadLetteredCount: 1,
    }))
  })

  it('requeues unattempted batch recipients from the DLQ consumer', async () => {
    const { env, db, notificationFetch, queueSend, queueSendBatch } = createEnv()
    for (const email of ['first@example.com', 'second@example.com']) {
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
      TRACKED_PUBLISH_PAYLOAD,
      { Authorization: 'Bearer admin-token' }
    )
    const result = await response.json() as { sendId: string }
    const [queueBody] = await drainFirstFanoutJob(env, queueSend, queueSendBatch)
    const { batch } = createQueueBatch(queueBody, 'haben-letterdrop-dlq')
    queueSend.mockClear()
    notificationFetch.mockClear()

    await worker.queue(batch, env)

    expect(notificationFetch).not.toHaveBeenCalled()
    expect(queueSend).toHaveBeenCalledTimes(1)
    expect(queueSend.mock.calls[0][0]).toEqual(expect.objectContaining({
      kind: 'recipientBatch',
      recipients: [
        expect.objectContaining({ email: 'first@example.com' }),
        expect.objectContaining({ email: 'second@example.com' }),
      ],
    }))
    expect(queueSend.mock.calls[0][1]).toEqual({ delaySeconds: 60 })
    expect(Array.from(db.newsletterSendRecipients.values()).map((recipient) => (
      recipient.status
    ))).toEqual(['queued', 'queued'])
    expect(db.newsletterSends.get(result.sendId)).toEqual(expect.objectContaining({
      status: 'sending',
      deadLetteredCount: 0,
    }))
  })
})

describe('stateless newsletter unsubscribe links', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  async function sendQueuedNewsletterAndExtractToken() {
    const { env, db, notificationFetch } = createEnv()
    const storedEmail = 'User@Example.com'
    const subscriberKey = `${NEWSLETTER_ID}:${storedEmail}`
    db.subscribers.set(subscriberKey, {
      email: storedEmail,
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
      email: storedEmail,
      newsletterId: NEWSLETTER_ID,
      subject: 'Unsubscribe test',
      fileName,
      textFileName,
    })

    await worker.queue(batch, env)
    const sendBody = await getNotificationRequestBody(notificationFetch)
    return { env, db, subscriberKey, token: extractUnsubscribeToken(sendBody) }
  }

  it('supports RFC 8058 one-click POST unsubscribe', async () => {
    const { env, db, subscriberKey, token } = await sendQueuedNewsletterAndExtractToken()

    const response = await postJson(env, `/api/subscribe/list-unsubscribe/${token}`, {})

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      message: 'Unsubscribed successfully',
    })
    expect(db.subscribers.get(subscriberKey)?.isSubscribed).toBe(0)
    expect(db.subscribers.has(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`)).toBe(false)
  })

  it('rejects tampered unsubscribe tokens without changing subscriber state', async () => {
    const { env, db, subscriberKey, token } = await sendQueuedNewsletterAndExtractToken()
    const tamperedToken = `${token.slice(0, -1)}x`

    const response = await postJson(env, `/api/subscribe/list-unsubscribe/${tamperedToken}`, {})

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid unsubscribe token',
    })
    expect(db.subscribers.get(subscriberKey)?.isSubscribed).toBe(1)
  })

  it('renders visible GET unsubscribe confirmation without unsubscribing', async () => {
    const { env, db, subscriberKey, token } = await sendQueuedNewsletterAndExtractToken()

    const response = await app.request(
      `https://example.com/api/subscribe/unsubscribe/${token}`,
      {},
      env
    )

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toContain('Confirm unsubscribe')
    expect(db.subscribers.get(subscriberKey)?.isSubscribed).toBe(1)
  })

  it('supports visible POST unsubscribe confirmation', async () => {
    const { env, db, subscriberKey, token } = await sendQueuedNewsletterAndExtractToken()

    const response = await postJson(env, `/api/subscribe/unsubscribe/${token}`, {})

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toContain('Unsubscribed successfully')
    expect(db.subscribers.get(subscriberKey)?.isSubscribed).toBe(0)
  })
})

describe('SES SNS suppression webhook', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('records permanent bounces and unsubscribes matching newsletter subscribers', async () => {
    const { env, db } = createEnv()
    const { signEnvelope } = await createSnsSigner()
    const storedEmail = 'User@Example.com'
    const subscriberKey = `${NEWSLETTER_ID}:${storedEmail}`
    db.subscribers.set(subscriberKey, {
      email: storedEmail,
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
    expect(db.subscribers.get(subscriberKey)?.isSubscribed).toBe(0)
    expect(db.subscribers.has(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`)).toBe(false)
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
            recipientHash: [firstRecipientHashFromQueueBody(queueBody)],
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
      recipientHash: [firstRecipientHashFromQueueBody(queueBody)],
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
            recipientHash: [firstRecipientHashFromQueueBody(queueBody)],
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
    const storedEmail = 'User@Example.com'
    const subscriberKey = `${NEWSLETTER_ID}:${storedEmail}`
    db.subscribers.set(subscriberKey, {
      email: storedEmail,
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
    await expect(response.json()).resolves.toEqual({
      message: 'SES notification processed',
      recordedCount: 1,
      unsubscribedCount: 1,
    })
    expect(db.subscribers.get(subscriberKey)?.isSubscribed).toBe(0)
    expect(db.subscribers.has(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`)).toBe(false)
    expect(db.suppressionEvents[0].eventType).toBe('complaint')
  })

  it('records suppressions without claiming an unsubscribe when no subscriber matches', async () => {
    const { env, db } = createEnv()
    const { signEnvelope } = await createSnsSigner()

    const response = await postJson(env, '/api/ses/sns/ses-webhook-token', await signEnvelope({
      Type: 'Notification',
      TopicArn: env.SES_SNS_TOPIC_ARN,
      Message: JSON.stringify({
        notificationType: 'Complaint',
        mail: {
          messageId: 'missing-subscriber-complaint',
          tags: { newsletterId: [NEWSLETTER_ID] },
        },
        complaint: {
          complainedRecipients: [{ emailAddress: 'missing@example.com' }],
        },
      }),
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      message: 'SES notification processed',
      recordedCount: 1,
      unsubscribedCount: 0,
    })
    expect(db.suppressionEvents[0]).toEqual(expect.objectContaining({
      email: 'missing@example.com',
      eventType: 'complaint',
    }))
    expect(db.subscribers.size).toBe(0)
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

  it('renders a confirmation page on GET without consuming the token', async () => {
    const { env, db, kv } = createEnv()
    const token = 'confirm-token'
    await kv.put(token, JSON.stringify({
      action: 'confirm',
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
    }))

    // Scanner-style repeated GETs must never mutate state.
    for (let i = 0; i < 3; i += 1) {
      const response = await app.request(`https://example.com/api/subscribe/confirm/${token}`, {}, env)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      const body = await response.text()
      expect(body).toContain('Confirm your subscription')
      expect(body).toContain(`/api/subscribe/confirm/${token}`)
    }

    expect(db.subscribers.get(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`)).toBeUndefined()
    expect(JSON.parse(kv.store.get(token) ?? '{}')).not.toHaveProperty('usedAt')
  })

  it('confirms on POST and shows an already-confirmed page on reuse', async () => {
    const { env, db, kv } = createEnv()
    const token = 'confirm-token'
    await kv.put(token, JSON.stringify({
      action: 'confirm',
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
    }))

    const postResponse = await app.request(`https://example.com/api/subscribe/confirm/${token}`, { method: 'POST' }, env)
    expect(postResponse.status).toBe(303)
    expect(postResponse.headers.get('location')).toBe('https://habengirma.com/subscription-successful/')
    expect(db.subscribers.get(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`)?.isSubscribed).toBe(1)

    // The used marker keeps only the action — subscriber PII must not
    // outlive its purpose in KV — and gets the 24h notice TTL.
    const usedToken = JSON.parse(kv.store.get(token) ?? '{}')
    expect(typeof usedToken.usedAt).toBe('string')
    expect(usedToken).not.toHaveProperty('email')
    expect(usedToken).not.toHaveProperty('firstName')
    expect(kv.ttls.get(token)).toBe(60 * 60 * 24)

    const replayGet = await app.request(`https://example.com/api/subscribe/confirm/${token}`, {}, env)
    expect(replayGet.status).toBe(200)
    await expect(replayGet.text()).resolves.toContain('already been used')

    // A replayed POST (double-click) is idempotent success.
    const replayPost = await app.request(`https://example.com/api/subscribe/confirm/${token}`, { method: 'POST' }, env)
    expect(replayPost.status).toBe(303)
    expect(replayPost.headers.get('location')).toBe('https://habengirma.com/subscription-successful/')
  })

  it('renders a friendly page for missing or expired confirm tokens', async () => {
    const { env } = createEnv()

    const getResponse = await app.request('https://example.com/api/subscribe/confirm/unknown-token', {}, env)
    expect(getResponse.status).toBe(400)
    expect(getResponse.headers.get('content-type')).toContain('text/html')
    await expect(getResponse.text()).resolves.toContain('invalid or has expired')

    const postResponse = await app.request('https://example.com/api/subscribe/confirm/unknown-token', { method: 'POST' }, env)
    expect(postResponse.status).toBe(400)
    await expect(postResponse.text()).resolves.toContain('invalid or has expired')
  })

  it('preserves manager notes when a subscriber confirms again', async () => {
    const { env, db, kv } = createEnv()
    const storedEmail = 'User@Example.com'
    const subscriberKey = `${NEWSLETTER_ID}:${storedEmail}`
    db.subscribers.set(subscriberKey, {
      email: storedEmail,
      newsletterId: NEWSLETTER_ID,
      firstName: 'Ada',
      lastName: 'Lovelace',
      notes: 'Private manager context',
      isSubscribed: 0,
      subscribedAt: '2026-01-01T00:00:00.000Z',
      unsubscribedAt: '2026-02-01T00:00:00.000Z',
      deletedAt: null,
    })

    const token = 'confirm-token-with-untrusted-notes'
    await kv.put(token, JSON.stringify({
      action: 'confirm',
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
      firstName: 'Updated',
      notes: 'Attempted public note',
    }))

    const response = await app.request(
      `https://example.com/api/subscribe/confirm/${token}`,
      { method: 'POST' },
      env
    )

    expect(response.status).toBe(303)
    expect(db.subscribers.get(subscriberKey)).toMatchObject({
      email: storedEmail,
      isSubscribed: 1,
      firstName: 'Updated',
      notes: 'Private manager context',
    })
    expect(db.subscribers.has(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`)).toBe(false)
  })

  it('splits cancel into GET interstitial and POST, preserving locale rendering', async () => {
    const { env, db, kv } = createEnv()
    const storedEmail = 'User@Example.com'
    const subscriberKey = `${NEWSLETTER_ID}:${storedEmail}`
    db.subscribers.set(subscriberKey, {
      email: storedEmail,
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

    const zhHeaders = { 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' }

    const getResponse = await app.request(`https://example.com/api/subscribe/cancel/${token}`, {
      headers: zhHeaders,
    }, env)
    expect(getResponse.status).toBe(200)
    const interstitial = await getResponse.text()
    expect(interstitial).toContain('确认取消订阅')
    expect(interstitial).toContain(`/api/subscribe/cancel/${token}`)
    expect(db.subscribers.get(subscriberKey)?.isSubscribed).toBe(1)

    const postResponse = await app.request(`https://example.com/api/subscribe/cancel/${token}`, {
      method: 'POST',
      headers: zhHeaders,
    }, env)
    expect(postResponse.status).toBe(200)
    await expect(postResponse.text()).resolves.toContain('取消订阅成功')
    expect(db.subscribers.get(subscriberKey)?.isSubscribed).toBe(0)
    expect(db.subscribers.has(`${NEWSLETTER_ID}:${SUBSCRIBER_EMAIL}`)).toBe(false)

    const usedToken = JSON.parse(kv.store.get(token) ?? '{}')
    expect(typeof usedToken.usedAt).toBe('string')
    expect(usedToken).not.toHaveProperty('email')
    expect(kv.ttls.get(token)).toBe(60 * 60 * 24)

    const replayResponse = await app.request(`https://example.com/api/subscribe/cancel/${token}`, {
      method: 'POST',
      headers: zhHeaders,
    }, env)
    expect(replayResponse.status).toBe(200)
    await expect(replayResponse.text()).resolves.toContain('已取消订阅')

    const replayEnglish = await app.request(`https://example.com/api/subscribe/cancel/${token}`, {}, env)
    expect(replayEnglish.status).toBe(200)
    await expect(replayEnglish.text()).resolves.toContain('Already unsubscribed')
  })

  it('renders a friendly page for missing or expired cancel tokens', async () => {
    const { env } = createEnv()

    const getResponse = await app.request('https://example.com/api/subscribe/cancel/unknown-token', {}, env)
    expect(getResponse.status).toBe(400)
    expect(getResponse.headers.get('content-type')).toContain('text/html')
    await expect(getResponse.text()).resolves.toContain('invalid or has expired')

    const postResponse = await app.request('https://example.com/api/subscribe/cancel/unknown-token', { method: 'POST' }, env)
    expect(postResponse.status).toBe(400)
    await expect(postResponse.text()).resolves.toContain('invalid or has expired')
  })

  it('rejects tokens presented to the wrong endpoint', async () => {
    const { env, db, kv } = createEnv()
    await kv.put('stray-cancel-token', JSON.stringify({
      action: 'cancel',
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
    }))
    await kv.put('stray-confirm-token', JSON.stringify({
      action: 'confirm',
      email: SUBSCRIBER_EMAIL,
      newsletterId: NEWSLETTER_ID,
    }))

    const confirmWithCancelToken = await app.request('https://example.com/api/subscribe/confirm/stray-cancel-token', { method: 'POST' }, env)
    expect(confirmWithCancelToken.status).toBe(400)
    await expect(confirmWithCancelToken.text()).resolves.toContain('invalid or has expired')

    const cancelWithConfirmToken = await app.request('https://example.com/api/subscribe/cancel/stray-confirm-token', { method: 'POST' }, env)
    expect(cancelWithConfirmToken.status).toBe(400)
    await expect(cancelWithConfirmToken.text()).resolves.toContain('invalid or has expired')

    expect(db.subscribers.size).toBe(0)
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
    const { env, notificationFetch, kv } = createEnv({
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

    const [issuedToken] = [...kv.store.keys()]
    expect(issuedToken).toBeDefined()
    expect(kv.ttls.get(issuedToken)).toBe(60 * 60 * 24)
  })
})
