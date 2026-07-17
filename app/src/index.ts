import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";
import PostalMime from "postal-mime";

type Bindings = {
  DB: D1Database;
  NOTIFICATION: Fetcher;
  KV: KVNamespace;
  R2: R2Bucket;
  QUEUE: Queue<NewsletterQueueMessage>;
  SEND_STATUS_BROKER?: DurableObjectNamespace;
  ALLOWED_EMAILS: string;
  PUBLISH_EMAIL_ADDRESS: string;
  NOTIFICATION_SHARED_SECRET?: string;
  PUBLIC_ORIGIN?: string;
  PUBLISH_BRIDGE_TOKEN: string;
  ADMIN_API_TOKEN: string;
  TURNSTILE_SECRET_KEY: string;
  TURNSTILE_SITE_KEY: string;
  UNSUBSCRIBE_SIGNING_SECRET?: string;
  SES_SNS_WEBHOOK_TOKEN?: string;
  SES_SNS_TOPIC_ARN?: string;
};

type SubscriberInput = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  notes?: string | null;
};

type SubscriptionAction = "confirm" | "cancel";

type SubscriptionTokenPayload = {
  action?: SubscriptionAction;
  email?: string;
  newsletterId?: string;
  firstName?: string | null;
  lastName?: string | null;
};

type UnsubscribeTokenPayload = {
  v: 1;
  email: string;
  newsletterId: string;
};

type EmailHeader = {
  name: string;
  value: string;
};

type EmailTag = {
  name: string;
  value: string;
};

type SendEmailOptions = {
  fromName?: string | null;
  headers?: EmailHeader[];
  tags?: EmailTag[];
  idempotencyKey?: string | null;
};

type StoredPublishConfig = {
  fromName: string | null;
};

type PublishNewsletterInput = {
  newsletterId: string;
  subject: unknown;
  html: unknown;
  text: unknown;
  sourceMessageId?: unknown;
  allowEmptySubject?: boolean;
  allowBlankContent?: boolean;
};

type PublishNewsletterEmailInput = {
  from: unknown;
  subject: unknown;
  html: unknown;
  text: unknown;
  sourceMessageId?: unknown;
  allowBlankContent?: boolean;
};

type PublishNewsletterEmailSuccess = {
  ok: true;
  newsletterId: string;
  subject: string;
  fileName?: string;
  textFileName?: string;
  sendId?: string;
  send?: NewsletterSendSummary;
  recipientCount: number;
  queuedCount: number;
  queueFailedCount?: number;
  duplicate: boolean;
};

type PublishNewsletterEmailFailure = {
  ok: false;
  status: 400 | 403;
  error: string;
};

type PublishNewsletterEmailResult =
  | PublishNewsletterEmailSuccess
  | PublishNewsletterEmailFailure;

type LimitedJsonObjectResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response };

type NewsletterDraftSummary = {
  id: string;
  newsletterId: string;
  subject: string;
  sourceMessageId: string;
  contentFileName: string;
  textFileName: string;
  status: "draft" | "sent";
  sendId: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
};

type NewsletterDraftContent = {
  draft: NewsletterDraftSummary;
  html: string;
  text: string;
};

class NewsletterDraftSourceConflictError extends Error {
  constructor() {
    super("Newsletter draft sourceMessageId is already associated with a sent draft");
  }
}

type NewsletterRecipientQueueMessage = {
  kind?: "recipient";
  email: string;
  newsletterId: string;
  subject: string;
  fileName: string;
  textFileName?: string;
  fromName?: string | null;
  sendId?: string;
  recipientHash?: string;
};

type NewsletterRecipientQueueEntry = {
  email: string;
  recipientHash: string;
};

type NewsletterRecipientBatchQueueMessage = {
  kind: "recipientBatch";
  newsletterId: string;
  subject: string;
  fileName: string;
  textFileName?: string;
  fromName?: string | null;
  sendId: string;
  recipients: NewsletterRecipientQueueEntry[];
};

type NewsletterFanoutQueueMessage = {
  kind: "fanout";
  newsletterId: string;
  subject: string;
  fileName: string;
  textFileName?: string;
  fromName?: string | null;
  sendId: string;
  sourceMessageId: string;
  cursorEmail?: string | null;
  chunkIndex: number;
};

type NewsletterQueueMessage =
  | NewsletterRecipientQueueMessage
  | NewsletterRecipientBatchQueueMessage
  | NewsletterFanoutQueueMessage;

type NewsletterSendStatus =
  | "queued"
  | "sending"
  | "completed"
  | "completedWithFailures"
  | "duplicate";

type NewsletterSendRecipientStatus =
  | "queued"
  | "sending"
  | "providerAccepted"
  | "deliveryDelayed"
  | "delivered"
  | "bounced"
  | "complained"
  | "retrying"
  | "failed"
  | "deadLettered"
  | "needsReview";

type NewsletterSendSummary = {
  id: string;
  newsletterId: string;
  subject: string;
  sourceMessageId: string | null;
  status: NewsletterSendStatus;
  recipientCount: number;
  queuedCount: number;
  fanoutQueuedCount: number;
  sendingCount: number;
  retryingCount: number;
  queueFailedCount: number;
  providerAcceptedCount: number;
  deliveredCount: number;
  deliveryDelayedCount: number;
  bouncedCount: number;
  complainedCount: number;
  failedCount: number;
  deadLetteredCount: number;
  needsReviewCount: number;
  lastError: string | null;
  contentFileName: string | null;
  textFileName: string | null;
  fromName: string | null;
  fanoutSnapshotAt: string | null;
  fanoutCursorEmail: string | null;
  fanoutCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type NewsletterSendRecipient = {
  id: string;
  sendId: string;
  newsletterId: string;
  email: string;
  recipientHash: string;
  status: NewsletterSendRecipientStatus;
  attempts: number;
  failureType: string | null;
  providerMessageId: string | null;
  lastError: string | null;
  queuedAt: string | null;
  sendingAt: string | null;
  providerAcceptedAt: string | null;
  deliveryDelayedAt: string | null;
  deliveredAt: string | null;
  bouncedAt: string | null;
  complainedAt: string | null;
  failedAt: string | null;
  deadLetteredAt: string | null;
  needsReviewAt: string | null;
  updatedAt: string;
};

type NewsletterSendEvent = {
  id: number;
  sendId: string;
  newsletterId: string;
  recipientId: string | null;
  recipientHash: string | null;
  email: string | null;
  eventType: string;
  recipientStatus: NewsletterSendRecipientStatus | null;
  sendStatus: NewsletterSendStatus | null;
  message: string | null;
  providerMessageId: string | null;
  createdAt: string;
};

type NewsletterSendStreamMessage =
  | { type: "connected"; sendId: string }
  | {
      type: "sendEvent";
      event: NewsletterSendEvent;
      send?: NewsletterSendSummary;
      recipient?: NewsletterSendRecipient;
    };

type SesSnsEnvelope = {
  Type?: unknown;
  MessageId?: unknown;
  Message?: unknown;
  Subject?: unknown;
  TopicArn?: unknown;
  Timestamp?: unknown;
  SignatureVersion?: unknown;
  Signature?: unknown;
  SigningCertURL?: unknown;
  SubscribeURL?: unknown;
  Token?: unknown;
};

type SesNotification = {
  eventType?: unknown;
  notificationType?: unknown;
  mail?: {
    messageId?: unknown;
    destination?: unknown;
    tags?: Record<string, unknown>;
  };
  bounce?: {
    bounceType?: unknown;
    bouncedRecipients?: unknown;
  };
  complaint?: {
    complainedRecipients?: unknown;
  };
  delivery?: {
    recipients?: unknown;
  };
  deliveryDelay?: {
    delayedRecipients?: unknown;
    delayType?: unknown;
  };
  reject?: {
    reason?: unknown;
  };
};

const NOTIFICATION_BASE_URL = "http://haben-notification";
const NOTIFICATION_AUTH_HEADER = "X-LetterDrop-Notification-Token";
const PUBLISH_CONFIG_KV_KEY = "publish-config";
const DEFAULT_PUBLIC_ORIGIN = "https://newsletter.habengirma.com";
const D1_BATCH_LIMIT = 100;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTERNAL_ERROR_MESSAGE = "Internal server error";
const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const RATE_LIMIT_GC_SAMPLE_RATE = 0.01;
const PRE_TURNSTILE_MAX_REQUESTS = 30;
const PRE_TURNSTILE_WINDOW_SECONDS = 60;
const POST_TURNSTILE_IP_MAX_REQUESTS = 20;
const POST_TURNSTILE_TARGET_MAX_REQUESTS = 3;
const POST_TURNSTILE_WINDOW_SECONDS = 60 * 60;
const MISSING_ABUSE_EVENT_TABLE_FRAGMENT = "no such table: AbuseEvent";
const MAX_PUBLISH_REQUEST_BYTES = 5 * 1024 * 1024;
const MAX_FROM_NAME_LENGTH = 120;
const MAX_SUPPRESSION_PAYLOAD_LENGTH = 20_000;
const NEWSLETTER_SEND_EVENT_PAGE_SIZE = 500;
const NEWSLETTER_SEND_RECIPIENT_PAGE_SIZE = 100;
const NEWSLETTER_SEND_MAX_RECIPIENT_PAGE_SIZE = 250;
const NEWSLETTER_SEND_STREAM_REPLAY_LIMIT = 100;
const NEWSLETTER_FANOUT_PAGE_SIZE = 100;
const NEWSLETTER_RECIPIENT_BATCH_SIZE = 25;
const NEWSLETTER_ESTIMATED_SES_SEND_RATE_PER_SECOND = 14;
const NEWSLETTER_QUEUE_RETRY_DELAY_SECONDS = 60;
const NEWSLETTER_SEND_RECIPIENT_SEARCH_MAX_BYTES = 256;

let hasLoggedMissingAbuseEventMigration = false;

export const app = new Hono<{ Bindings: Bindings }>();
type AppContext = Context<{ Bindings: Bindings }>;

// HTML escaping to prevent XSS
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Parse and clamp pagination parameters
function parsePagination(query: { page?: string; limit?: string }) {
  const page = Math.max(1, parseInt(query.page || "1") || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || "50") || 50));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function normalizeOptionalName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return EMAIL_REGEX.test(normalized) ? normalized : null;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeFromNameForStorage(
  value: unknown,
): { ok: true; fromName: string | null } | { ok: false; error: string } {
  if (value === null) {
    return { ok: true, fromName: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "fromName must be a string or null" };
  }

  const fromName = value.trim();
  if (fromName.length === 0) {
    return { ok: true, fromName: null };
  }
  if (fromName.length > MAX_FROM_NAME_LENGTH) {
    return { ok: false, error: "fromName must be 120 characters or fewer" };
  }
  if (/[\r\n<>]/.test(fromName)) {
    return { ok: false, error: "fromName contains invalid characters" };
  }
  return { ok: true, fromName };
}

function parseStoredPublishConfig(value: string | null): StoredPublishConfig {
  if (!value) {
    return { fromName: null };
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { fromName: null };
    }
    const fromName = (parsed as Record<string, unknown>).fromName;
    const normalized = normalizeFromNameForStorage(fromName ?? null);
    return { fromName: normalized.ok ? normalized.fromName : null };
  } catch {
    return { fromName: null };
  }
}

async function getPublishConfig(env: Bindings): Promise<StoredPublishConfig> {
  return parseStoredPublishConfig(await env.KV.get(PUBLISH_CONFIG_KV_KEY));
}

async function storePublishConfig(
  env: Bindings,
  config: StoredPublishConfig,
): Promise<void> {
  if (!config.fromName) {
    await env.KV.delete(PUBLISH_CONFIG_KV_KEY);
    return;
  }
  await env.KV.put(PUBLISH_CONFIG_KV_KEY, JSON.stringify(config));
}

function getPublicOrigin(env: Bindings): string {
  const configuredOrigin = env.PUBLIC_ORIGIN?.trim() || DEFAULT_PUBLIC_ORIGIN;
  try {
    const url = new URL(configuredOrigin);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return url.origin;
    }
  } catch {
    // Fall back to the production origin when local config is malformed.
  }
  return DEFAULT_PUBLIC_ORIGIN;
}

function getUnsubscribeSigningSecret(env: Bindings): string | null {
  return normalizeNonEmptyString(env.UNSUBSCRIBE_SIGNING_SECRET);
}

function getNotificationSharedSecret(env: Bindings): string | null {
  return normalizeNonEmptyString(env.NOTIFICATION_SHARED_SECRET);
}

function extractEmailAddress(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const angleAddressMatch = value.match(/<([^<>]+)>/);
  if (angleAddressMatch) {
    return normalizeEmail(angleAddressMatch[1]);
  }

  return normalizeEmail(value);
}

function getAllowedSenderEmails(env: Bindings): string[] {
  return env.ALLOWED_EMAILS.split(",")
    .map((email) => normalizeEmail(email))
    .filter((email): email is string => Boolean(email));
}

function parseNewsletterEmailSubject(
  subject: string,
): { newsletterId: string; subject: string } | null {
  const newsletterIdMatch = subject.match(
    /\[Newsletter-ID:([0-9a-f-]{36})\]/i,
  );
  if (!newsletterIdMatch) {
    return null;
  }
  const newsletterId = newsletterIdMatch[1];

  if (!isValidUuid(newsletterId)) {
    return null;
  }

  return {
    newsletterId,
    subject: subject.replace(newsletterIdMatch[0], "").trim(),
  };
}

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function getClientIp(c: AppContext): string {
  const cfConnectingIp = c.req.header("CF-Connecting-IP");
  if (cfConnectingIp) {
    return cfConnectingIp;
  }
  const forwardedFor = c.req.header("X-Forwarded-For");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  return "unknown";
}

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const first = encoder.encode(a);
  const second = encoder.encode(b);

  if (first.length !== second.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < first.length; i += 1) {
    mismatch |= first[i] ^ second[i];
  }
  return mismatch === 0;
}

function timingSafeEqualBytes(first: Uint8Array, second: Uint8Array): boolean {
  if (first.byteLength !== second.byteLength) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < first.byteLength; i += 1) {
    mismatch |= first[i] ^ second[i];
  }
  return mismatch === 0;
}

function getBearerToken(authorization: string | undefined): string | null {
  if (!authorization) {
    return null;
  }
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function logError(scope: string, error: unknown) {
  if (error instanceof Error) {
    console.error(`[${scope}] ${error.message}`, error.stack);
    return;
  }
  console.error(`[${scope}]`, error);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function internalServerError(c: AppContext, scope: string, error: unknown) {
  logError(scope, error);
  return c.json({ error: INTERNAL_ERROR_MESSAGE }, 500);
}

function jsonResponseWithStatus(
  body: Record<string, unknown>,
  status: number,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getJsonStringField(
  body: Record<string, unknown>,
  field: string,
): string | null {
  const value = body[field];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

async function readRequestBytesWithLimit(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  if (!reader) {
    return new Uint8Array();
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function readLimitedJsonObject(
  c: AppContext,
): Promise<LimitedJsonObjectResult> {
  const contentLength = Number(c.req.header("Content-Length") ?? "0");
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_PUBLISH_REQUEST_BYTES
  ) {
    return {
      ok: false,
      response: c.json({ error: "Request body too large" }, 413),
    };
  }

  const bodyBytes = await readRequestBytesWithLimit(
    c.req.raw,
    MAX_PUBLISH_REQUEST_BYTES,
  );
  if (!bodyBytes) {
    return {
      ok: false,
      response: c.json({ error: "Request body too large" }, 413),
    };
  }

  try {
    const parsedBody = JSON.parse(new TextDecoder().decode(bodyBytes)) as unknown;
    if (
      !parsedBody ||
      typeof parsedBody !== "object" ||
      Array.isArray(parsedBody)
    ) {
      return {
        ok: false,
        response: c.json({ error: "Invalid JSON payload" }, 400),
      };
    }

    return { ok: true, body: parsedBody as Record<string, unknown> };
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return {
        ok: false,
        response: c.json({ error: "Invalid JSON payload" }, 400),
      };
    }
    throw error;
  }
}

function parseSubscriptionToken(
  tokenString: string,
): SubscriptionTokenPayload | null {
  try {
    const payload = JSON.parse(tokenString) as SubscriptionTokenPayload;
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }

  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");

  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function base64Decode(value: string): Uint8Array | null {
  const normalized = value.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    return null;
  }

  try {
    const binary = atob(normalized);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return new Uint8Array(signature);
}

async function createUnsubscribeToken(
  env: Bindings,
  email: string,
  newsletterId: string,
): Promise<string> {
  const secret = getUnsubscribeSigningSecret(env);
  if (!secret) {
    throw new Error("UNSUBSCRIBE_SIGNING_SECRET secret is not configured");
  }

  const payload: UnsubscribeTokenPayload = { v: 1, email, newsletterId };
  const encodedPayload = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = await hmacSha256(secret, encodedPayload);
  return `${encodedPayload}.${base64UrlEncode(signature)}`;
}

async function parseUnsubscribeToken(
  env: Bindings,
  token: string,
): Promise<UnsubscribeTokenPayload | null> {
  const secret = getUnsubscribeSigningSecret(env);
  if (!secret) {
    return null;
  }

  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra !== undefined) {
    return null;
  }

  const signature = base64UrlDecode(encodedSignature);
  if (!signature) {
    return null;
  }

  const expectedSignature = await hmacSha256(secret, encodedPayload);
  if (!timingSafeEqualBytes(signature, expectedSignature)) {
    return null;
  }

  const payloadBytes = base64UrlDecode(encodedPayload);
  if (!payloadBytes) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(payloadBytes),
    ) as Partial<UnsubscribeTokenPayload>;
    const email = normalizeEmail(parsed.email);
    const newsletterId =
      typeof parsed.newsletterId === "string" ? parsed.newsletterId : "";
    if (parsed.v !== 1 || !email || !isValidUuid(newsletterId)) {
      return null;
    }
    return { v: 1, email, newsletterId };
  } catch {
    return null;
  }
}

type DerNode = {
  tag: number;
  start: number;
  valueStart: number;
  valueEnd: number;
  end: number;
};

function readDerNode(bytes: Uint8Array, offset: number): DerNode | null {
  if (offset < 0 || offset + 2 > bytes.byteLength) {
    return null;
  }

  const start = offset;
  const tag = bytes[offset];
  let cursor = offset + 1;
  const lengthByte = bytes[cursor];
  cursor += 1;

  let length = 0;
  if ((lengthByte & 0x80) === 0) {
    length = lengthByte;
  } else {
    const lengthByteCount = lengthByte & 0x7f;
    if (
      lengthByteCount === 0 ||
      lengthByteCount > 4 ||
      cursor + lengthByteCount > bytes.byteLength
    ) {
      return null;
    }
    for (let index = 0; index < lengthByteCount; index += 1) {
      length = (length << 8) | bytes[cursor + index];
    }
    cursor += lengthByteCount;
  }

  const valueStart = cursor;
  const valueEnd = valueStart + length;
  if (valueEnd > bytes.byteLength) {
    return null;
  }
  return { tag, start, valueStart, valueEnd, end: valueEnd };
}

function extractSubjectPublicKeyInfoFromCertificate(
  certificateDer: Uint8Array,
): Uint8Array | null {
  const certificate = readDerNode(certificateDer, 0);
  if (
    !certificate ||
    certificate.tag !== 0x30 ||
    certificate.end !== certificateDer.byteLength
  ) {
    return null;
  }

  const tbsCertificate = readDerNode(certificateDer, certificate.valueStart);
  if (
    !tbsCertificate ||
    tbsCertificate.tag !== 0x30 ||
    tbsCertificate.end > certificate.valueEnd
  ) {
    return null;
  }

  let cursor = tbsCertificate.valueStart;
  const first = readDerNode(certificateDer, cursor);
  if (!first) {
    return null;
  }
  if (first.tag === 0xa0) {
    cursor = first.end;
  }

  for (let skippedField = 0; skippedField < 5; skippedField += 1) {
    const node = readDerNode(certificateDer, cursor);
    if (!node || node.end > tbsCertificate.valueEnd) {
      return null;
    }
    cursor = node.end;
  }

  const subjectPublicKeyInfo = readDerNode(certificateDer, cursor);
  if (
    !subjectPublicKeyInfo ||
    subjectPublicKeyInfo.tag !== 0x30 ||
    subjectPublicKeyInfo.end > tbsCertificate.valueEnd
  ) {
    return null;
  }
  return certificateDer.slice(
    subjectPublicKeyInfo.start,
    subjectPublicKeyInfo.end,
  );
}

function decodePemBlock(pem: string, label: string): Uint8Array | null {
  const pattern = new RegExp(
    `-----BEGIN ${label}-----\\s*([A-Za-z0-9+/=\\s]+?)\\s*-----END ${label}-----`,
  );
  const match = pem.match(pattern);
  if (!match) {
    return null;
  }
  return base64Decode(match[1]);
}

function extractPublicKeyDerFromPem(pem: string): Uint8Array | null {
  const publicKey = decodePemBlock(pem, "PUBLIC KEY");
  if (publicKey) {
    return publicKey;
  }

  const certificate = decodePemBlock(pem, "CERTIFICATE");
  return certificate
    ? extractSubjectPublicKeyInfoFromCertificate(certificate)
    : null;
}

function getStringField(
  envelope: SesSnsEnvelope,
  field: keyof SesSnsEnvelope,
): string | null {
  const value = envelope[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getSnsTopicRegion(topicArn: string): string | null {
  const [, , service, region] = topicArn.split(":");
  return service === "sns" && region ? region : null;
}

function isTrustedSnsHost(hostname: string, topicArn: string): boolean {
  const region = getSnsTopicRegion(topicArn);
  if (region) {
    return hostname === `sns.${region}.amazonaws.com`;
  }
  return /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(hostname);
}

function parseTrustedSnsUrl(
  value: string,
  topicArn: string,
): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !isTrustedSnsHost(url.hostname, topicArn)
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function isTrustedSnsSigningCertUrl(
  value: string,
  topicArn: string,
): boolean {
  const url = parseTrustedSnsUrl(value, topicArn);
  return Boolean(
    url &&
      !url.search &&
      !url.hash &&
      /^\/SimpleNotificationService-[A-Za-z0-9]+\.pem$/.test(url.pathname),
  );
}

function isTrustedSnsSubscribeUrl(
  value: string,
  topicArn: string,
  token: string,
): boolean {
  const url = parseTrustedSnsUrl(value, topicArn);
  return Boolean(
    url &&
      url.searchParams.get("Action") === "ConfirmSubscription" &&
      url.searchParams.get("TopicArn") === topicArn &&
      url.searchParams.get("Token") === token,
  );
}

function buildSnsStringToSign(envelope: SesSnsEnvelope): string | null {
  const type = getStringField(envelope, "Type");
  const fields =
    type === "Notification"
      ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
      : type === "SubscriptionConfirmation" ||
          type === "UnsubscribeConfirmation"
        ? [
            "Message",
            "MessageId",
            "SubscribeURL",
            "Timestamp",
            "Token",
            "TopicArn",
            "Type",
          ]
        : null;
  if (!fields) {
    return null;
  }

  const pairs: string[] = [];
  for (const field of fields) {
    if (field === "Subject" && typeof envelope.Subject !== "string") {
      continue;
    }
    const value = getStringField(envelope, field as keyof SesSnsEnvelope);
    if (!value) {
      return null;
    }
    pairs.push(`${field}\n${value}`);
  }
  return `${pairs.join("\n")}\n`;
}

async function verifySnsEnvelopeSignature(
  envelope: SesSnsEnvelope,
): Promise<boolean> {
  const stringToSign = buildSnsStringToSign(envelope);
  const topicArn = getStringField(envelope, "TopicArn");
  const signature = getStringField(envelope, "Signature");
  const signatureVersion = getStringField(envelope, "SignatureVersion");
  const signingCertUrl = getStringField(envelope, "SigningCertURL");
  if (
    !stringToSign ||
    !topicArn ||
    !signature ||
    !signatureVersion ||
    !signingCertUrl ||
    !isTrustedSnsSigningCertUrl(signingCertUrl, topicArn)
  ) {
    return false;
  }

  const hash =
    signatureVersion === "2"
      ? "SHA-256"
      : signatureVersion === "1"
        ? "SHA-1"
        : null;
  const signatureBytes = base64Decode(signature);
  if (!hash || !signatureBytes) {
    return false;
  }

  const certificateResponse = await fetch(signingCertUrl);
  if (!certificateResponse.ok) {
    throw new Error(
      `Failed to fetch SNS signing certificate: ${certificateResponse.status}`,
    );
  }

  const publicKeyDer = extractPublicKeyDerFromPem(
    await certificateResponse.text(),
  );
  if (!publicKeyDer) {
    return false;
  }

  try {
    const key = await crypto.subtle.importKey(
      "spki",
      publicKeyDer,
      { name: "RSASSA-PKCS1-v1_5", hash },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signatureBytes,
      new TextEncoder().encode(stringToSign),
    );
  } catch {
    return false;
  }
}

async function confirmSnsSubscription(
  envelope: SesSnsEnvelope,
): Promise<boolean> {
  const topicArn = getStringField(envelope, "TopicArn");
  const subscribeUrl = getStringField(envelope, "SubscribeURL");
  const token = getStringField(envelope, "Token");
  if (
    !topicArn ||
    !subscribeUrl ||
    !token ||
    !isTrustedSnsSubscribeUrl(subscribeUrl, topicArn, token)
  ) {
    return false;
  }

  const response = await fetch(subscribeUrl, { method: "GET" });
  if (!response.ok) {
    throw new Error(`SNS subscription confirmation failed: ${response.status}`);
  }
  return true;
}

async function cleanupRateLimitEvents(db: D1Database): Promise<void> {
  try {
    await db
      .prepare(`DELETE FROM AbuseEvent WHERE createdAt < ?`)
      .bind(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .run();
  } catch (error: unknown) {
    logError("rate-limit-cleanup", error);
  }
}

function isMissingAbuseEventTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(MISSING_ABUSE_EVENT_TABLE_FRAGMENT);
}

function logMissingAbuseEventMigrationWarning() {
  if (hasLoggedMissingAbuseEventMigration) {
    return;
  }
  hasLoggedMissingAbuseEventMigration = true;
  console.error(
    "[rate-limit] AbuseEvent table is missing. Run db/20260223_add_abuse_event_table.sql before deploy. Bypassing subscription rate limits until migration is applied.",
  );
}

async function enforceRateLimit(
  db: D1Database,
  rule: {
    bucket: string;
    key: string;
    maxRequests: number;
    windowSeconds: number;
  },
): Promise<boolean> {
  try {
    const now = Date.now();
    const keyHash = await sha256Hex(rule.key);
    const sinceIso = new Date(now - rule.windowSeconds * 1000).toISOString();
    const insertResult = await db
      .prepare(
        `INSERT INTO AbuseEvent (id, bucket, key_hash, createdAt)
       SELECT ?, ?, ?, ?
       WHERE (
         SELECT COUNT(*)
         FROM AbuseEvent
         WHERE bucket = ? AND key_hash = ? AND createdAt >= ?
       ) < ?`,
      )
      .bind(
        crypto.randomUUID(),
        rule.bucket,
        keyHash,
        new Date(now).toISOString(),
        rule.bucket,
        keyHash,
        sinceIso,
        rule.maxRequests,
      )
      .run();

    const inserted = Number(insertResult.meta.changes ?? 0) > 0;
    if (!inserted) {
      return false;
    }

    if (Math.random() < RATE_LIMIT_GC_SAMPLE_RATE) {
      await cleanupRateLimitEvents(db);
    }

    return true;
  } catch (error: unknown) {
    // Fail open for public subscribe flows if migration has not been applied yet.
    if (isMissingAbuseEventTableError(error)) {
      logMissingAbuseEventMigrationWarning();
      return true;
    }
    throw error;
  }
}

async function verifyTurnstile(
  env: Bindings,
  token: string,
  remoteIp: string,
): Promise<boolean> {
  if (!token || !env.TURNSTILE_SECRET_KEY) {
    return false;
  }

  const body = new URLSearchParams();
  body.set("secret", env.TURNSTILE_SECRET_KEY);
  body.set("response", token);
  if (remoteIp !== "unknown") {
    body.set("remoteip", remoteIp);
  }

  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    return false;
  }

  const result = (await response.json()) as { success?: boolean };
  return result.success === true;
}

app.use(
  "/api/subscribe/*",
  cors({
    origin: "https://habengirma.com",
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  }),
);

const adminAuthMiddleware = async (c: AppContext, next: Next) => {
  if (c.req.method === "OPTIONS") {
    await next();
    return;
  }

  const adminApiToken = c.env.ADMIN_API_TOKEN?.trim();
  if (!adminApiToken) {
    logError(
      "admin-auth",
      new Error("ADMIN_API_TOKEN secret is not configured"),
    );
    return c.json({ error: "Admin API unavailable" }, 503);
  }

  const requestToken = getBearerToken(c.req.header("Authorization"));
  if (!requestToken || !timingSafeEqual(requestToken, adminApiToken)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
};

app.use("/api/newsletter", adminAuthMiddleware);
app.use("/api/newsletter/*", adminAuthMiddleware);

// Private Routes for managing Newsletters
// Protected by Cloudflare Access policy at the edge
app.post("/api/newsletter", async (c) => {
  const {
    title,
    description,
    logo = null,
  } = await c.req.json<{
    title: string;
    description: string;
    logo?: string | null;
  }>();

  const id = crypto.randomUUID();

  const createdAt = new Date().toISOString();
  const updatedAt = createdAt;

  await c.env.R2.put(
    `newsletters/${id}/index.md`,
    `# ${title}\n\n${description}`,
  );

  try {
    await c.env.DB.prepare(
      `INSERT INTO Newsletter (id, title, description, logo, subscribable, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, title, description, logo, 1, createdAt, updatedAt)
      .run();

    return c.json(
      {
        id,
        title,
        description,
        logo,
        subscribable: true,
        subscriberCount: 0,
        createdAt,
        updatedAt,
      },
      201,
    );
  } catch (error: unknown) {
    return internalServerError(c, "create-newsletter", error);
  }
});

app.put("/api/newsletter/:newsletterId/offline", async (c) => {
  const { newsletterId } = c.req.param();

  try {
    await c.env.DB.prepare(
      `UPDATE Newsletter SET subscribable = ? WHERE id = ?`,
    )
      .bind(0, newsletterId)
      .run();

    return c.json({ message: "Newsletter taken offline successfully" });
  } catch (error: unknown) {
    return internalServerError(c, "set-newsletter-offline", error);
  }
});

app.put("/api/newsletter/:newsletterId/online", async (c) => {
  const { newsletterId } = c.req.param();

  try {
    await c.env.DB.prepare(
      `UPDATE Newsletter SET subscribable = ? WHERE id = ?`,
    )
      .bind(1, newsletterId)
      .run();

    return c.json({ message: "Newsletter brought online successfully" });
  } catch (error: unknown) {
    return internalServerError(c, "set-newsletter-online", error);
  }
});

// List all newsletters with subscriber counts
app.get("/api/newsletter", async (c) => {
  const { page, limit, offset } = parsePagination({
    page: c.req.query("page"),
    limit: c.req.query("limit"),
  });

  try {
    const countResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM Newsletter`,
    ).first<{ total: number }>();
    const total = countResult?.total ?? 0;

    const { results } = await c.env.DB.prepare(
      `SELECT n.*, COUNT(s.email) as subscriberCount
       FROM Newsletter n
       LEFT JOIN Subscriber s ON n.id = s.newsletter_id AND s.isSubscribed = 1
       GROUP BY n.id
       ORDER BY n.createdAt DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(limit, offset)
      .all();

    return c.json({ newsletters: results, pagination: { page, limit, total } });
  } catch (error: unknown) {
    return internalServerError(c, "list-newsletters", error);
  }
});

app.get("/api/newsletter/publish-config", async (c) => {
  const emailAddress = normalizeEmail(c.env.PUBLISH_EMAIL_ADDRESS);
  if (!emailAddress) {
    return c.json({ error: "Publish email address unavailable" }, 503);
  }

  try {
    const publishConfig = await getPublishConfig(c.env);
    return c.json({ emailAddress, fromName: publishConfig.fromName });
  } catch (error: unknown) {
    return internalServerError(c, "get-publish-config", error);
  }
});

app.put("/api/newsletter/publish-config", async (c) => {
  const emailAddress = normalizeEmail(c.env.PUBLISH_EMAIL_ADDRESS);
  if (!emailAddress) {
    return c.json({ error: "Publish email address unavailable" }, 503);
  }

  try {
    const parsedBody = await readLimitedJsonObject(c);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    if (!Object.hasOwn(parsedBody.body, "fromName")) {
      return c.json({ error: "fromName is required" }, 400);
    }

    const normalized = normalizeFromNameForStorage(parsedBody.body.fromName);
    if (!normalized.ok) {
      return c.json({ error: normalized.error }, 400);
    }

    await storePublishConfig(c.env, { fromName: normalized.fromName });
    return c.json({ emailAddress, fromName: normalized.fromName });
  } catch (error: unknown) {
    return internalServerError(c, "update-publish-config", error);
  }
});

app.get("/api/newsletter/ses-diagnostics", async (c) => {
  const notificationSharedSecret = getNotificationSharedSecret(c.env);
  if (!notificationSharedSecret) {
    logError(
      "ses-diagnostics",
      new Error("NOTIFICATION_SHARED_SECRET secret is not configured"),
    );
    return c.json({ error: "Notification service unavailable" }, 503);
  }

  try {
    const response = await c.env.NOTIFICATION.fetch(
      new Request(`${NOTIFICATION_BASE_URL}/diagnostics/ses`, {
        method: "GET",
        headers: {
          [NOTIFICATION_AUTH_HEADER]: notificationSharedSecret,
        },
      }),
    );
    const body = await response.json<unknown>().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "Invalid SES diagnostics response" }, 502);
    }

    const jsonBody = body as Record<string, unknown>;
    if (!response.ok) {
      const error =
        getJsonStringField(jsonBody, "detail") ??
        getJsonStringField(jsonBody, "error") ??
        getJsonStringField(jsonBody, "message") ??
        `Notification service returned HTTP ${response.status}`;
      return jsonResponseWithStatus({ error }, response.status);
    }

    return c.json(jsonBody);
  } catch (error: unknown) {
    logError("ses-diagnostics", error);
    return c.json({ error: "SES diagnostics unavailable" }, 502);
  }
});

app.post("/api/newsletter/:newsletterId/publish/dry-run", async (c) => {
  const { newsletterId } = c.req.param();
  if (!isValidUuid(newsletterId)) {
    return c.json({ error: "Invalid newsletterId" }, 400);
  }

  try {
    const newsletter = await c.env.DB.prepare(
      `SELECT id FROM Newsletter WHERE id = ?`,
    )
      .bind(newsletterId)
      .first<{ id: string }>();

    if (!newsletter) {
      return c.json({ error: "Newsletter not found" }, 404);
    }

    const parsedBody = await readLimitedJsonObject(c);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const body = parsedBody.body;
    const sourceMessageId = normalizeNonEmptyString(body.sourceMessageId);
    if (!sourceMessageId) {
      return c.json({ error: "sourceMessageId is required" }, 400);
    }
    if (typeof body.subject !== "string" || body.subject.trim().length === 0) {
      return c.json({ error: "Subject is required" }, 400);
    }
    const html = typeof body.html === "string" ? body.html : "";
    const text = typeof body.text === "string" ? body.text : "";
    if (html.trim().length === 0 || text.trim().length === 0) {
      return c.json({ error: "Email html and text are required" }, 400);
    }

    const existingSend = await getNewsletterSendSummaryBySourceMessage(
      c.env.DB,
      newsletterId,
      sourceMessageId,
    );
    const snapshotAt = new Date().toISOString();
    const recipientCount = await countSubscribedSubscribers(
      newsletterId,
      c.env.DB,
      snapshotAt,
    );
    const estimatedFanoutChunks = Math.ceil(
      recipientCount / NEWSLETTER_FANOUT_PAGE_SIZE,
    );
    const estimatedRecipientQueueBatches = Math.ceil(
      recipientCount / NEWSLETTER_RECIPIENT_BATCH_SIZE,
    );
    const estimatedSesSendSeconds = Math.ceil(
      recipientCount / NEWSLETTER_ESTIMATED_SES_SEND_RATE_PER_SECOND,
    );

    return c.json({
      newsletterId,
      subject: body.subject.trim(),
      recipientCount,
      estimatedFanoutChunks,
      estimatedRecipientQueueBatches,
      fanoutChunkSize: NEWSLETTER_FANOUT_PAGE_SIZE,
      recipientBatchSize: NEWSLETTER_RECIPIENT_BATCH_SIZE,
      estimatedSesSendRatePerSecond: NEWSLETTER_ESTIMATED_SES_SEND_RATE_PER_SECOND,
      estimatedSesSendSeconds,
      wouldSendEmail: false,
      freePlanSafe: false,
      paidPlanOptimized: true,
      duplicate: existingSend !== null,
      sendId: existingSend?.id ?? null,
      send: existingSend,
    });
  } catch (error: unknown) {
    return internalServerError(c, "publish-newsletter-dry-run", error);
  }
});

app.post("/api/newsletter/:newsletterId/publish", async (c) => {
  const { newsletterId } = c.req.param();
  if (!isValidUuid(newsletterId)) {
    return c.json({ error: "Invalid newsletterId" }, 400);
  }

  try {
    const newsletter = await c.env.DB.prepare(
      `SELECT id FROM Newsletter WHERE id = ?`,
    )
      .bind(newsletterId)
      .first<{ id: string }>();

    if (!newsletter) {
      return c.json({ error: "Newsletter not found" }, 404);
    }

    const parsedBody = await readLimitedJsonObject(c);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const body = parsedBody.body;

    const result = await publishNewsletter(c.env, {
      newsletterId,
      subject: body.subject,
      html: body.html,
      text: body.text,
      sourceMessageId: body.sourceMessageId,
    });

    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }

    return c.json({
      newsletterId: result.newsletterId,
      subject: result.subject,
      fileName: result.fileName,
      textFileName: result.textFileName,
      sendId: result.sendId,
      send: result.send,
      recipientCount: result.recipientCount,
      queuedCount: result.queuedCount,
      queueFailedCount: result.queueFailedCount ?? 0,
      duplicate: result.duplicate,
    });
  } catch (error: unknown) {
    return internalServerError(c, "publish-newsletter-direct", error);
  }
});

app.get("/api/newsletter/:newsletterId/sends", async (c) => {
  const { newsletterId } = c.req.param();
  if (!isValidUuid(newsletterId)) {
    return c.json({ error: "Invalid newsletterId" }, 400);
  }

  try {
    const sends = await listNewsletterSendSummaries(c.env.DB, newsletterId);
    return c.json({ sends });
  } catch (error: unknown) {
    return internalServerError(c, "list-newsletter-sends", error);
  }
});

app.get("/api/newsletter/:newsletterId/sends/:sendId", async (c) => {
  const { newsletterId, sendId } = c.req.param();
  if (!isValidUuid(newsletterId) || !isValidUuid(sendId)) {
    return c.json({ error: "Invalid newsletterId or sendId" }, 400);
  }

  try {
    const send = await getNewsletterSendSummary(c.env.DB, sendId);
    if (!send || send.newsletterId !== newsletterId) {
      return c.json({ error: "Newsletter send not found" }, 404);
    }
    const recipientPage = await getNewsletterSendRecipientsPage(c.env.DB, sendId);
    const events = await getLatestNewsletterSendEvents(c.env.DB, sendId, 100);
    const lastEventId = await getNewsletterSendLastEventId(c.env.DB, sendId);
    return c.json({
      send,
      recipients: recipientPage.recipients,
      recipientPagination: recipientPage.pagination,
      events,
      lastEventId,
    });
  } catch (error: unknown) {
    return internalServerError(c, "get-newsletter-send", error);
  }
});

app.get("/api/newsletter/:newsletterId/sends/:sendId/recipients", async (c) => {
  const { newsletterId, sendId } = c.req.param();
  if (!isValidUuid(newsletterId) || !isValidUuid(sendId)) {
    return c.json({ error: "Invalid newsletterId or sendId" }, 400);
  }

  try {
    const send = await getNewsletterSendSummary(c.env.DB, sendId);
    if (!send || send.newsletterId !== newsletterId) {
      return c.json({ error: "Newsletter send not found" }, 404);
    }
    const rawStatus = c.req.query("status");
    if (rawStatus && !isNewsletterSendRecipientStatus(rawStatus)) {
      return c.json({ error: "Invalid recipient status" }, 400);
    }
    const status = isNewsletterSendRecipientStatus(rawStatus) ? rawStatus : null;
    const query = c.req.query("q") ?? null;
    if (query && utf8ByteLength(query) > NEWSLETTER_SEND_RECIPIENT_SEARCH_MAX_BYTES) {
      return c.json(
        { error: `Recipient search must be ${NEWSLETTER_SEND_RECIPIENT_SEARCH_MAX_BYTES} bytes or fewer` },
        400,
      );
    }
    const page = await getNewsletterSendRecipientsPage(c.env.DB, sendId, {
      cursorEmail: c.req.query("cursor") ?? null,
      limit: boundedInt(
        c.req.query("limit"),
        NEWSLETTER_SEND_RECIPIENT_PAGE_SIZE,
        1,
        NEWSLETTER_SEND_MAX_RECIPIENT_PAGE_SIZE,
      ),
      status,
      query,
    });
    return c.json(page);
  } catch (error: unknown) {
    return internalServerError(c, "list-newsletter-send-recipients", error);
  }
});

app.get("/api/newsletter/:newsletterId/sends/:sendId/events", async (c) => {
  const { newsletterId, sendId } = c.req.param();
  if (!isValidUuid(newsletterId) || !isValidUuid(sendId)) {
    return c.json({ error: "Invalid newsletterId or sendId" }, 400);
  }

  try {
    const send = await getNewsletterSendSummary(c.env.DB, sendId);
    if (!send || send.newsletterId !== newsletterId) {
      return c.json({ error: "Newsletter send not found" }, 404);
    }
    const afterEventId = Math.max(
      0,
      Number(c.req.query("afterEventId") ?? "0") || 0,
    );
    const limit = boundedInt(
      c.req.query("limit"),
      NEWSLETTER_SEND_EVENT_PAGE_SIZE,
      1,
      NEWSLETTER_SEND_EVENT_PAGE_SIZE,
    );
    const events = await getNewsletterSendEvents(c.env.DB, sendId, afterEventId, limit);
    const lastEventId = await getNewsletterSendLastEventId(c.env.DB, sendId);
    return c.json({
      events,
      lastEventId,
      pagination: {
        limit,
        nextAfterEventId: events.length > 0 ? events[events.length - 1].id : null,
        hasMore: events.length === limit && (events.at(-1)?.id ?? afterEventId) < lastEventId,
      },
    });
  } catch (error: unknown) {
    return internalServerError(c, "list-newsletter-send-events", error);
  }
});

app.get("/api/newsletter/:newsletterId/sends/:sendId/stream", async (c) => {
  const { newsletterId, sendId } = c.req.param();
  if (!isValidUuid(newsletterId) || !isValidUuid(sendId)) {
    return c.json({ error: "Invalid newsletterId or sendId" }, 400);
  }
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.json({ error: "Expected WebSocket upgrade" }, 426);
  }
  if (!c.env.SEND_STATUS_BROKER) {
    return c.json({ error: "Send status stream unavailable" }, 503);
  }

  try {
    const send = await getNewsletterSendSummary(c.env.DB, sendId);
    if (!send || send.newsletterId !== newsletterId) {
      return c.json({ error: "Newsletter send not found" }, 404);
    }
    const afterEventId = Math.max(
      0,
      Number(c.req.query("afterEventId") ?? "0") || 0,
    );
    const stub = c.env.SEND_STATUS_BROKER.getByName(sendId);
    return stub.fetch(
      new Request(
        `https://send-status-broker/stream?newsletterId=${encodeURIComponent(
          newsletterId,
        )}&sendId=${encodeURIComponent(sendId)}&afterEventId=${afterEventId}`,
        { headers: c.req.raw.headers },
      ),
    );
  } catch (error: unknown) {
    return internalServerError(c, "stream-newsletter-send", error);
  }
});

app.get("/api/newsletter/:newsletterId/drafts", async (c) => {
  const { newsletterId } = c.req.param();
  if (!isValidUuid(newsletterId)) {
    return c.json({ error: "Invalid newsletterId" }, 400);
  }

  try {
    if (!(await newsletterExists(c.env.DB, newsletterId))) {
      return c.json({ error: "Newsletter not found" }, 404);
    }
    const drafts = await listNewsletterDraftSummaries(c.env.DB, newsletterId);
    return c.json({ drafts });
  } catch (error: unknown) {
    return internalServerError(c, "list-newsletter-drafts", error);
  }
});

app.post("/api/newsletter/:newsletterId/drafts", async (c) => {
  const { newsletterId } = c.req.param();
  if (!isValidUuid(newsletterId)) {
    return c.json({ error: "Invalid newsletterId" }, 400);
  }

  try {
    if (!(await newsletterExists(c.env.DB, newsletterId))) {
      return c.json({ error: "Newsletter not found" }, 404);
    }
    const parsedBody = await readLimitedJsonObject(c);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const subject = draftStringField(parsedBody.body, "subject", "");
    const html = draftStringField(parsedBody.body, "html", "");
    const text = draftStringField(parsedBody.body, "text", "");
    if (!subject.ok) return c.json({ error: subject.error }, 400);
    if (!html.ok) return c.json({ error: html.error }, 400);
    if (!text.ok) return c.json({ error: text.error }, 400);

    try {
      const draft = await createNewsletterDraft(c.env, {
        newsletterId,
        subject: subject.value,
        html: html.value,
        text: text.value,
        sourceMessageId: normalizeNonEmptyString(parsedBody.body.sourceMessageId),
      });
      return c.json({ draft, html: html.value, text: text.value }, 201);
    } catch (error: unknown) {
      if (error instanceof NewsletterDraftSourceConflictError) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  } catch (error: unknown) {
    return internalServerError(c, "create-newsletter-draft", error);
  }
});

app.get("/api/newsletter/:newsletterId/drafts/:draftId", async (c) => {
  const { newsletterId, draftId } = c.req.param();
  if (!isValidUuid(newsletterId) || !isValidUuid(draftId)) {
    return c.json({ error: "Invalid newsletterId or draftId" }, 400);
  }

  try {
    const draft = await getNewsletterDraftSummary(c.env.DB, draftId);
    if (!draft || draft.newsletterId !== newsletterId || draft.status !== "draft") {
      return c.json({ error: "Newsletter draft not found" }, 404);
    }
    const content = await getNewsletterDraftContent(c.env, draft);
    if (!content) {
      return c.json({ error: "Newsletter draft content not found" }, 404);
    }
    return c.json(content);
  } catch (error: unknown) {
    return internalServerError(c, "get-newsletter-draft", error);
  }
});

app.put("/api/newsletter/:newsletterId/drafts/:draftId", async (c) => {
  const { newsletterId, draftId } = c.req.param();
  if (!isValidUuid(newsletterId) || !isValidUuid(draftId)) {
    return c.json({ error: "Invalid newsletterId or draftId" }, 400);
  }

  try {
    const draft = await getNewsletterDraftSummary(c.env.DB, draftId);
    if (!draft || draft.newsletterId !== newsletterId) {
      return c.json({ error: "Newsletter draft not found" }, 404);
    }
    if (draft.status !== "draft") {
      return c.json({ error: "Newsletter draft has already been sent" }, 409);
    }
    const content = await getNewsletterDraftContent(c.env, draft);
    if (!content) {
      return c.json({ error: "Newsletter draft content not found" }, 404);
    }
    const parsedBody = await readLimitedJsonObject(c);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const subject = draftStringField(parsedBody.body, "subject", draft.subject);
    const html = draftStringField(parsedBody.body, "html", content.html);
    const text = draftStringField(parsedBody.body, "text", content.text);
    if (!subject.ok) return c.json({ error: subject.error }, 400);
    if (!html.ok) return c.json({ error: html.error }, 400);
    if (!text.ok) return c.json({ error: text.error }, 400);

    const updated = await updateNewsletterDraft(c.env, draft, {
      subject: subject.value,
      html: html.value,
      text: text.value,
    });
    return c.json({ draft: updated, html: html.value, text: text.value });
  } catch (error: unknown) {
    return internalServerError(c, "update-newsletter-draft", error);
  }
});

app.delete("/api/newsletter/:newsletterId/drafts/:draftId", async (c) => {
  const { newsletterId, draftId } = c.req.param();
  if (!isValidUuid(newsletterId) || !isValidUuid(draftId)) {
    return c.json({ error: "Invalid newsletterId or draftId" }, 400);
  }

  try {
    const draft = await getNewsletterDraftSummary(c.env.DB, draftId);
    if (!draft || draft.newsletterId !== newsletterId || draft.status !== "draft") {
      return c.json({ error: "Newsletter draft not found" }, 404);
    }
    await c.env.DB.prepare(`DELETE FROM NewsletterDraft WHERE id = ?`)
      .bind(draftId)
      .run();
    await Promise.allSettled([
      c.env.R2.delete(draft.contentFileName),
      c.env.R2.delete(draft.textFileName),
    ]);
    return c.json({ message: "Newsletter draft deleted successfully" });
  } catch (error: unknown) {
    return internalServerError(c, "delete-newsletter-draft", error);
  }
});

app.post("/api/newsletter/:newsletterId/drafts/:draftId/send", async (c) => {
  const { newsletterId, draftId } = c.req.param();
  if (!isValidUuid(newsletterId) || !isValidUuid(draftId)) {
    return c.json({ error: "Invalid newsletterId or draftId" }, 400);
  }

  try {
    const draft = await getNewsletterDraftSummary(c.env.DB, draftId);
    if (!draft || draft.newsletterId !== newsletterId) {
      return c.json({ error: "Newsletter draft not found" }, 404);
    }
    if (draft.status !== "draft") {
      return c.json({ error: "Newsletter draft has already been sent" }, 409);
    }
    const parsedBody = await readLimitedJsonObject(c);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const body = parsedBody.body;
    const requestedSourceMessageId = normalizeNonEmptyString(body.sourceMessageId);
    if (requestedSourceMessageId && requestedSourceMessageId !== draft.sourceMessageId) {
      return c.json({ error: "sourceMessageId does not match the draft" }, 409);
    }

    const needsStoredContent = body.html === undefined || body.text === undefined;
    const content = needsStoredContent
      ? await getNewsletterDraftContent(c.env, draft)
      : null;
    if (needsStoredContent && !content) {
      return c.json({ error: "Newsletter draft content not found" }, 404);
    }
    const subject = draftStringField(body, "subject", draft.subject);
    const html = draftStringField(body, "html", content?.html ?? "");
    const text = draftStringField(body, "text", content?.text ?? "");
    if (!subject.ok) return c.json({ error: subject.error }, 400);
    if (!html.ok) return c.json({ error: html.error }, 400);
    if (!text.ok) return c.json({ error: text.error }, 400);

    const result = await publishNewsletter(c.env, {
      newsletterId,
      subject: subject.value,
      html: html.value,
      text: text.value,
      sourceMessageId: draft.sourceMessageId,
    });

    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }

    await markNewsletterDraftSent(c.env.DB, draftId, result.sendId ?? null);

    return c.json({
      newsletterId: result.newsletterId,
      subject: result.subject,
      fileName: result.fileName,
      textFileName: result.textFileName,
      sendId: result.sendId,
      send: result.send,
      recipientCount: result.recipientCount,
      queuedCount: result.queuedCount,
      queueFailedCount: result.queueFailedCount ?? 0,
      duplicate: result.duplicate,
    });
  } catch (error: unknown) {
    return internalServerError(c, "send-newsletter-draft", error);
  }
});

app.get("/api/newsletter/:newsletterId/sends/:sendId/content", async (c) => {
  const { newsletterId, sendId } = c.req.param();
  if (!isValidUuid(newsletterId) || !isValidUuid(sendId)) {
    return c.json({ error: "Invalid newsletterId or sendId" }, 400);
  }

  try {
    const send = await getNewsletterSendSummary(c.env.DB, sendId);
    if (!send || send.newsletterId !== newsletterId) {
      return c.json({ error: "Newsletter send not found" }, 404);
    }
    const [html, text] = await Promise.all([
      readR2Text(c.env, send.contentFileName),
      readR2Text(c.env, send.textFileName),
    ]);
    if (html === null || text === null) {
      return c.json({ error: "Newsletter send content not found" }, 404);
    }
    return c.json({ send, html, text });
  } catch (error: unknown) {
    return internalServerError(c, "get-newsletter-send-content", error);
  }
});

app.post("/api/newsletter/:newsletterId/sends/:sendId/draft", async (c) => {
  const { newsletterId, sendId } = c.req.param();
  if (!isValidUuid(newsletterId) || !isValidUuid(sendId)) {
    return c.json({ error: "Invalid newsletterId or sendId" }, 400);
  }

  try {
    const send = await getNewsletterSendSummary(c.env.DB, sendId);
    if (!send || send.newsletterId !== newsletterId) {
      return c.json({ error: "Newsletter send not found" }, 404);
    }
    const [html, text] = await Promise.all([
      readR2Text(c.env, send.contentFileName),
      readR2Text(c.env, send.textFileName),
    ]);
    if (html === null || text === null) {
      return c.json({ error: "Newsletter send content not found" }, 404);
    }
    try {
      const draft = await createNewsletterDraft(c.env, {
        newsletterId,
        subject: send.subject,
        html,
        text,
      });
      return c.json({ draft, html, text }, 201);
    } catch (error: unknown) {
      if (error instanceof NewsletterDraftSourceConflictError) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  } catch (error: unknown) {
    return internalServerError(c, "create-newsletter-draft-from-send", error);
  }
});

app.post("/api/publish/google-workspace", async (c) => {
  const bridgeToken = c.env.PUBLISH_BRIDGE_TOKEN?.trim();
  if (!bridgeToken) {
    logError(
      "publish-bridge-auth",
      new Error("PUBLISH_BRIDGE_TOKEN secret is not configured"),
    );
    return c.json({ error: "Publish bridge unavailable" }, 503);
  }

  const requestToken = getBearerToken(c.req.header("Authorization"));
  if (!requestToken || !timingSafeEqual(requestToken, bridgeToken)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const parsedBody = await readLimitedJsonObject(c);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }
    const body = parsedBody.body;

    const result = await publishNewsletterEmail(c.env, {
      from: body.from,
      subject: body.subject,
      html: body.html,
      text: body.text,
      sourceMessageId: body.sourceMessageId ?? body.messageId,
    });

    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }

    return c.json({
      newsletterId: result.newsletterId,
      subject: result.subject,
      fileName: result.fileName,
      textFileName: result.textFileName,
      sendId: result.sendId,
      send: result.send,
      recipientCount: result.recipientCount,
      queuedCount: result.queuedCount,
      queueFailedCount: result.queueFailedCount ?? 0,
      duplicate: result.duplicate,
    });
  } catch (error: unknown) {
    return internalServerError(c, "publish-google-workspace", error);
  }
});

// Get single newsletter with subscriber count
app.get("/api/newsletter/:newsletterId", async (c) => {
  const { newsletterId } = c.req.param();

  try {
    const newsletter = await c.env.DB.prepare(
      `SELECT n.*, COUNT(s.email) as subscriberCount
       FROM Newsletter n
       LEFT JOIN Subscriber s ON n.id = s.newsletter_id AND s.isSubscribed = 1
       WHERE n.id = ?
       GROUP BY n.id`,
    )
      .bind(newsletterId)
      .first();

    if (!newsletter) {
      return c.json({ error: "Newsletter not found" }, 404);
    }

    return c.json(newsletter);
  } catch (error: unknown) {
    return internalServerError(c, "get-newsletter", error);
  }
});

// Update newsletter (partial update)
app.put("/api/newsletter/:newsletterId", async (c) => {
  const { newsletterId } = c.req.param();
  const body = await c.req.json<{
    title?: string;
    description?: string;
    logo?: string | null;
  }>();

  try {
    const existing = await c.env.DB.prepare(
      `SELECT * FROM Newsletter WHERE id = ?`,
    )
      .bind(newsletterId)
      .first();

    if (!existing) {
      return c.json({ error: "Newsletter not found" }, 404);
    }

    const title = body.title ?? (existing.title as string);
    const description = body.description ?? (existing.description as string);
    const logo =
      body.logo !== undefined ? body.logo : (existing.logo as string | null);
    const updatedAt = new Date().toISOString();

    await c.env.DB.prepare(
      `UPDATE Newsletter SET title = ?, description = ?, logo = ?, updatedAt = ? WHERE id = ?`,
    )
      .bind(title, description, logo, updatedAt, newsletterId)
      .run();

    await c.env.R2.put(
      `newsletters/${newsletterId}/index.md`,
      `# ${title}\n\n${description}`,
    );

    const subscriberCount = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM Subscriber WHERE newsletter_id = ? AND isSubscribed = 1`,
    )
      .bind(newsletterId)
      .first<{ count: number }>();

    return c.json({
      id: newsletterId,
      title,
      description,
      logo,
      subscribable: existing.subscribable,
      subscriberCount: subscriberCount?.count ?? 0,
      createdAt: existing.createdAt,
      updatedAt,
    });
  } catch (error: unknown) {
    return internalServerError(c, "update-newsletter", error);
  }
});

// Delete newsletter + subscribers + R2 cleanup
app.delete("/api/newsletter/:newsletterId", async (c) => {
  const { newsletterId } = c.req.param();

  try {
    const existing = await c.env.DB.prepare(
      `SELECT id FROM Newsletter WHERE id = ?`,
    )
      .bind(newsletterId)
      .first();

    if (!existing) {
      return c.json({ error: "Newsletter not found" }, 404);
    }

    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM NewsletterDraft WHERE newsletter_id = ?`).bind(
        newsletterId,
      ),
      c.env.DB.prepare(`DELETE FROM Subscriber WHERE newsletter_id = ?`).bind(
        newsletterId,
      ),
      c.env.DB.prepare(`DELETE FROM Newsletter WHERE id = ?`).bind(
        newsletterId,
      ),
    ]);

    // Best-effort R2 cleanup with cursor pagination
    try {
      let cursor: string | undefined;
      do {
        const objects = await c.env.R2.list({
          prefix: `newsletters/${newsletterId}/`,
          cursor,
        });
        if (objects.objects.length > 0) {
          await Promise.all(
            objects.objects.map((obj) => c.env.R2.delete(obj.key)),
          );
        }
        cursor = objects.truncated ? objects.cursor : undefined;
      } while (cursor);
    } catch {
      // R2 cleanup is best-effort
    }

    return c.json({ message: "Newsletter deleted successfully" });
  } catch (error: unknown) {
    return internalServerError(c, "delete-newsletter", error);
  }
});

// List subscribers for a newsletter
app.get("/api/newsletter/:newsletterId/subscribers", async (c) => {
  const { newsletterId } = c.req.param();
  const { page, limit, offset } = parsePagination({
    page: c.req.query("page"),
    limit: c.req.query("limit"),
  });

  try {
    const newsletter = await c.env.DB.prepare(
      `SELECT id FROM Newsletter WHERE id = ?`,
    )
      .bind(newsletterId)
      .first();

    if (!newsletter) {
      return c.json({ error: "Newsletter not found" }, 404);
    }

    const countResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM Subscriber WHERE newsletter_id = ? AND deleted_at IS NULL`,
    )
      .bind(newsletterId)
      .first<{ total: number }>();
    const total = countResult?.total ?? 0;

    const { results } = await c.env.DB.prepare(
      `SELECT * FROM Subscriber
       WHERE newsletter_id = ? AND deleted_at IS NULL
       ORDER BY upsertedAt DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(newsletterId, limit, offset)
      .all();

    return c.json({ subscribers: results, pagination: { page, limit, total } });
  } catch (error: unknown) {
    return internalServerError(c, "list-subscribers", error);
  }
});

// Add subscriber(s) to a newsletter
app.post("/api/newsletter/:newsletterId/subscribers", async (c) => {
  const { newsletterId } = c.req.param();
  const { subscribers } = await c.req.json<{
    subscribers: SubscriberInput[];
  }>();

  if (!subscribers || !Array.isArray(subscribers) || subscribers.length === 0) {
    return c.json({ error: "subscribers array is required" }, 400);
  }

  const normalizedSubscribers: Array<{
    email: string;
    firstName: string | null;
    lastName: string | null;
    notes: string | null;
    hasNotes: boolean;
  }> = [];

  for (const subscriber of subscribers) {
    if (!subscriber || typeof subscriber.email !== "string") {
      return c.json(
        { error: "Each subscriber must include an email field" },
        400,
      );
    }
    const normalizedEmail = normalizeEmail(subscriber.email);
    if (!normalizedEmail) {
      return c.json({ error: `Invalid email: ${subscriber.email}` }, 400);
    }
    const hasNotes = Object.hasOwn(subscriber, "notes");
    if (
      hasNotes &&
      subscriber.notes !== null &&
      typeof subscriber.notes !== "string"
    ) {
      return c.json({ error: "notes must be a string or null" }, 400);
    }
    normalizedSubscribers.push({
      email: normalizedEmail,
      firstName: normalizeOptionalName(subscriber.firstName),
      lastName: normalizeOptionalName(subscriber.lastName),
      notes: normalizeNonEmptyString(subscriber.notes),
      hasNotes,
    });
  }

  try {
    const newsletter = await c.env.DB.prepare(
      `SELECT id FROM Newsletter WHERE id = ?`,
    )
      .bind(newsletterId)
      .first();

    if (!newsletter) {
      return c.json({ error: "Newsletter not found" }, 404);
    }

    const now = new Date().toISOString();
    // Chunk into batches to respect D1's 100-statement batch limit
    for (let i = 0; i < normalizedSubscribers.length; i += D1_BATCH_LIMIT) {
      const chunk = normalizedSubscribers.slice(i, i + D1_BATCH_LIMIT);
      const statements = chunk.map(({ email, firstName, lastName, notes, hasNotes }) =>
        c.env.DB.prepare(
          `INSERT INTO Subscriber (
             email, first_name, last_name, notes, newsletter_id, isSubscribed,
             upsertedAt, subscribed_at, unsubscribed_at, deleted_at
           )
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, NULL, NULL)
           ON CONFLICT(email, newsletter_id) DO UPDATE SET
             isSubscribed = 1,
             first_name = COALESCE(excluded.first_name, Subscriber.first_name),
             last_name = COALESCE(excluded.last_name, Subscriber.last_name),
             notes = CASE
               WHEN ? = 1 THEN excluded.notes
               ELSE Subscriber.notes
             END,
             upsertedAt = excluded.upsertedAt,
             subscribed_at = CASE
               WHEN Subscriber.isSubscribed = 1
               THEN COALESCE(Subscriber.subscribed_at, excluded.subscribed_at)
               ELSE excluded.subscribed_at
             END,
             unsubscribed_at = NULL,
             deleted_at = NULL`,
        ).bind(
          email,
          firstName,
          lastName,
          notes,
          newsletterId,
          now,
          now,
          hasNotes ? 1 : 0,
        ),
      );
      await c.env.DB.batch(statements);
    }

    return c.json(
      { message: `${normalizedSubscribers.length} subscriber(s) added` },
      201,
    );
  } catch (error: unknown) {
    return internalServerError(c, "add-subscribers", error);
  }
});

// Update a subscriber managed by the authenticated admin app
app.patch("/api/newsletter/:newsletterId/subscribers/:email", async (c) => {
  const { newsletterId } = c.req.param();
  const originalEmail = normalizeEmail(c.req.param("email"));
  if (!originalEmail) {
    return c.json({ error: "Invalid subscriber email" }, 400);
  }

  try {
    const parsedBody = await readLimitedJsonObject(c);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const requiredFields = ["email", "firstName", "lastName", "notes"] as const;
    const missingField = requiredFields.find(
      (field) => !Object.hasOwn(parsedBody.body, field),
    );
    if (missingField) {
      return c.json({ error: `${missingField} is required` }, 400);
    }

    const updatedEmail = normalizeEmail(parsedBody.body.email);
    if (!updatedEmail) {
      return c.json({ error: "Invalid email" }, 400);
    }
    for (const field of ["firstName", "lastName", "notes"] as const) {
      const value = parsedBody.body[field];
      if (value !== null && typeof value !== "string") {
        return c.json({ error: `${field} must be a string or null` }, 400);
      }
    }

    const existing = await c.env.DB.prepare(
      `SELECT email FROM Subscriber
       WHERE email = ? AND newsletter_id = ? AND deleted_at IS NULL`,
    )
      .bind(originalEmail, newsletterId)
      .first<{ email: string }>();
    if (!existing) {
      return c.json({ error: "Subscriber not found" }, 404);
    }

    if (updatedEmail !== originalEmail) {
      const conflict = await c.env.DB.prepare(
        `SELECT email FROM Subscriber WHERE email = ? AND newsletter_id = ?`,
      )
        .bind(updatedEmail, newsletterId)
        .first<{ email: string }>();
      if (conflict) {
        return c.json({ error: "A subscriber with that email already exists" }, 409);
      }
    }

    const now = new Date().toISOString();
    try {
      await c.env.DB.prepare(
        `UPDATE Subscriber
         SET email = ?,
             first_name = ?,
             last_name = ?,
             notes = ?,
             upsertedAt = ?
         WHERE email = ? AND newsletter_id = ? AND deleted_at IS NULL`,
      )
        .bind(
          updatedEmail,
          normalizeOptionalName(parsedBody.body.firstName),
          normalizeOptionalName(parsedBody.body.lastName),
          normalizeNonEmptyString(parsedBody.body.notes),
          now,
          originalEmail,
          newsletterId,
        )
        .run();
    } catch (error: unknown) {
      const message = errorMessage(error, "").toLowerCase();
      if (message.includes("unique constraint") || message.includes("constraint failed")) {
        return c.json({ error: "A subscriber with that email already exists" }, 409);
      }
      throw error;
    }

    return c.json({ message: "Subscriber updated" });
  } catch (error: unknown) {
    return internalServerError(c, "update-subscriber", error);
  }
});

// Remove subscriber from a newsletter
app.delete("/api/newsletter/:newsletterId/subscribers/:email", async (c) => {
  const { newsletterId, email } = c.req.param();

  try {
    const subscriber = await c.env.DB.prepare(
      `SELECT email FROM Subscriber WHERE email = ? AND newsletter_id = ?`,
    )
      .bind(email, newsletterId)
      .first();

    if (!subscriber) {
      return c.json({ error: "Subscriber not found" }, 404);
    }

    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE Subscriber
       SET isSubscribed = 0,
           upsertedAt = ?,
           unsubscribed_at = COALESCE(unsubscribed_at, ?),
           deleted_at = ?
       WHERE email = ? AND newsletter_id = ?`,
    )
      .bind(now, now, now, email, newsletterId)
      .run();

    return c.json({ message: "Subscriber removed successfully" });
  } catch (error: unknown) {
    return internalServerError(c, "delete-subscriber", error);
  }
});

// Public Routes for managing Subscriptions
app.get("/api/subscribe/confirm/:token", async (c) => {
  const { token } = c.req.param();

  try {
    // Validate Token and Get Email
    const tokenString = await c.env.KV.get(token);
    if (!tokenString) {
      return c.json({ error: "Invalid or expired token" }, 400);
    }

    const tokenPayload = parseSubscriptionToken(tokenString);
    if (!tokenPayload || tokenPayload.action !== "confirm") {
      return c.json({ error: "Invalid or expired token" }, 400);
    }

    const email =
      typeof tokenPayload.email === "string" ? tokenPayload.email : "";
    const newsletterId =
      typeof tokenPayload.newsletterId === "string"
        ? tokenPayload.newsletterId
        : "";

    if (!email || !newsletterId || !isValidUuid(newsletterId)) {
      return c.json({ error: "Invalid or expired token" }, 400);
    }

    const firstName = normalizeOptionalName(tokenPayload.firstName);
    const lastName = normalizeOptionalName(tokenPayload.lastName);

    const now = new Date().toISOString();
    // Upsert Subscription
    await c.env.DB.prepare(
      `INSERT INTO Subscriber (
         email, first_name, last_name, newsletter_id, isSubscribed,
         upsertedAt, subscribed_at, unsubscribed_at, deleted_at
       )
       VALUES (?, ?, ?, ?, 1, ?, ?, NULL, NULL)
       ON CONFLICT(email, newsletter_id) DO UPDATE SET
         isSubscribed = 1,
         first_name = COALESCE(excluded.first_name, Subscriber.first_name),
         last_name = COALESCE(excluded.last_name, Subscriber.last_name),
         upsertedAt = excluded.upsertedAt,
         subscribed_at = CASE
           WHEN Subscriber.isSubscribed = 1
           THEN COALESCE(Subscriber.subscribed_at, excluded.subscribed_at)
           ELSE excluded.subscribed_at
         END,
         unsubscribed_at = NULL,
         deleted_at = NULL`,
    )
      .bind(email, firstName, lastName, newsletterId, now, now)
      .run();

    // Enforce one-time use semantics for confirmation links.
    await c.env.KV.delete(token);

    return c.redirect("https://habengirma.com/subscription-successful/");
  } catch (error: unknown) {
    return internalServerError(c, "confirm-subscription", error);
  }
});

app.get("/api/subscribe/cancel/:token", async (c) => {
  const { token } = c.req.param();

  try {
    // Validate Token and Get Email
    const tokenString = await c.env.KV.get(token);
    if (!tokenString) {
      return c.json({ error: "Invalid or expired token" }, 400);
    }

    const tokenPayload = parseSubscriptionToken(tokenString);
    if (!tokenPayload || tokenPayload.action !== "cancel") {
      return c.json({ error: "Invalid or expired token" }, 400);
    }

    const email =
      typeof tokenPayload.email === "string" ? tokenPayload.email : "";
    const newsletterId =
      typeof tokenPayload.newsletterId === "string"
        ? tokenPayload.newsletterId
        : "";

    if (!email || !newsletterId || !isValidUuid(newsletterId)) {
      return c.json({ error: "Invalid or expired token" }, 400);
    }

    // Update Subscription Status
    await markSubscriberUnsubscribed(c.env.DB, email, newsletterId);

    // Enforce one-time use semantics for cancellation links.
    await c.env.KV.delete(token);

    return renderHtml(c, "Unsubscribed successfully", "取消订阅成功");
  } catch (error: unknown) {
    return internalServerError(c, "cancel-subscription", error);
  }
});

app.post("/api/subscribe/list-unsubscribe/:token", async (c) => {
  const { token } = c.req.param();

  try {
    if (!getUnsubscribeSigningSecret(c.env)) {
      logError(
        "list-unsubscribe-config",
        new Error("UNSUBSCRIBE_SIGNING_SECRET secret is not configured"),
      );
      return c.json({ error: "Unsubscribe unavailable" }, 503);
    }

    const payload = await parseUnsubscribeToken(c.env, token);
    if (!payload) {
      return c.json({ error: "Invalid unsubscribe token" }, 400);
    }

    await markSubscriberUnsubscribed(
      c.env.DB,
      payload.email,
      payload.newsletterId,
    );
    return c.json({ message: "Unsubscribed successfully" });
  } catch (error: unknown) {
    return internalServerError(c, "one-click-unsubscribe", error);
  }
});

app.get("/api/subscribe/unsubscribe/:token", async (c) => {
  const { token } = c.req.param();

  try {
    if (!getUnsubscribeSigningSecret(c.env)) {
      logError(
        "visible-unsubscribe-config",
        new Error("UNSUBSCRIBE_SIGNING_SECRET secret is not configured"),
      );
      return c.json({ error: "Unsubscribe unavailable" }, 503);
    }

    const payload = await parseUnsubscribeToken(c.env, token);
    if (!payload) {
      return c.json({ error: "Invalid unsubscribe token" }, 400);
    }

    return renderUnsubscribeConfirmationHtml(c, token);
  } catch (error: unknown) {
    return internalServerError(c, "visible-unsubscribe-confirmation", error);
  }
});

app.post("/api/subscribe/unsubscribe/:token", async (c) => {
  const { token } = c.req.param();

  try {
    if (!getUnsubscribeSigningSecret(c.env)) {
      logError(
        "visible-unsubscribe-config",
        new Error("UNSUBSCRIBE_SIGNING_SECRET secret is not configured"),
      );
      return c.json({ error: "Unsubscribe unavailable" }, 503);
    }

    const payload = await parseUnsubscribeToken(c.env, token);
    if (!payload) {
      return c.json({ error: "Invalid unsubscribe token" }, 400);
    }

    await markSubscriberUnsubscribed(
      c.env.DB,
      payload.email,
      payload.newsletterId,
    );
    return renderHtml(c, "Unsubscribed successfully", "取消订阅成功");
  } catch (error: unknown) {
    return internalServerError(c, "visible-unsubscribe", error);
  }
});

app.post("/api/subscribe/send-confirmation", async (c) => {
  try {
    const body = await c.req.json<{
      email: string;
      newsletterId: string;
      turnstileToken: string;
      firstName?: string | null;
      lastName?: string | null;
    }>();
    const email = normalizeEmail(body.email);
    const newsletterId = body.newsletterId?.trim();
    const turnstileToken =
      typeof body.turnstileToken === "string" ? body.turnstileToken.trim() : "";
    const firstName = normalizeOptionalName(body.firstName);
    const lastName = normalizeOptionalName(body.lastName);

    if (!email || !newsletterId || !turnstileToken) {
      return c.json(
        { error: "email, newsletterId and turnstileToken are required" },
        400,
      );
    }
    if (!isValidUuid(newsletterId)) {
      return c.json({ error: "Invalid newsletterId" }, 400);
    }

    const requestIp = getClientIp(c);
    const preTurnstileIpAllowed = await enforceRateLimit(c.env.DB, {
      bucket: "subscribe-confirmation-precheck-ip",
      key: requestIp,
      maxRequests: PRE_TURNSTILE_MAX_REQUESTS,
      windowSeconds: PRE_TURNSTILE_WINDOW_SECONDS,
    });
    if (!preTurnstileIpAllowed) {
      c.header("Retry-After", String(PRE_TURNSTILE_WINDOW_SECONDS));
      return c.json({ error: "Too many requests" }, 429);
    }

    const turnstilePassed = await verifyTurnstile(
      c.env,
      turnstileToken,
      requestIp,
    );
    if (!turnstilePassed) {
      return c.json({ error: "Bot verification failed" }, 403);
    }

    const newsletter = await c.env.DB.prepare(
      `SELECT id, subscribable FROM Newsletter WHERE id = ?`,
    )
      .bind(newsletterId)
      .first<{ id: string; subscribable: number }>();
    if (!newsletter) {
      return c.json({ error: "Newsletter not found" }, 404);
    }
    if (!newsletter.subscribable) {
      return c.json({ error: "Newsletter is not subscribable" }, 409);
    }

    const ipAllowed = await enforceRateLimit(c.env.DB, {
      bucket: "subscribe-confirmation-ip",
      key: requestIp,
      maxRequests: POST_TURNSTILE_IP_MAX_REQUESTS,
      windowSeconds: POST_TURNSTILE_WINDOW_SECONDS,
    });
    if (!ipAllowed) {
      c.header("Retry-After", String(POST_TURNSTILE_WINDOW_SECONDS));
      return c.json({ error: "Too many requests" }, 429);
    }

    const targetAllowed = await enforceRateLimit(c.env.DB, {
      bucket: "subscribe-confirmation-target",
      key: `${newsletterId}:${email}`,
      maxRequests: POST_TURNSTILE_TARGET_MAX_REQUESTS,
      windowSeconds: POST_TURNSTILE_WINDOW_SECONDS,
    });
    if (!targetAllowed) {
      c.header("Retry-After", String(POST_TURNSTILE_WINDOW_SECONDS));
      return c.json({ error: "Too many requests" }, 429);
    }

    const token = crypto.randomUUID();
    const expiry = 60 * 60; // 1 hour in seconds

    // Store Token
    await c.env.KV.put(
      token,
      JSON.stringify({
        action: "confirm",
        email,
        newsletterId,
        firstName,
        lastName,
      }),
      { expirationTtl: expiry },
    );

    // Send Confirmation Email
    const confirmationUrl = `https://newsletter.habengirma.com/api/subscribe/confirm/${token}`;

    await sendEmail(
      c.env,
      email,
      "Confirm your subscription",
      `Thank you for expressing interest in the newsletter. There is one more step to complete your registration. Click the link below to verify that you want to register:\n\n${confirmationUrl}`,
      `<p>Thank you for expressing interest in the newsletter. There is one more step to complete your registration. Click the link below to verify that you want to register:</p><p><a href="${confirmationUrl}">Confirm your subscription</a></p>`,
    );
    return c.json({ message: "Confirmation email sent" });
  } catch (error: unknown) {
    return internalServerError(c, "send-confirmation-email", error);
  }
});

app.post("/api/subscribe/send-cancellation", async (c) => {
  try {
    const body = await c.req.json<{
      email: string;
      newsletterId: string;
      turnstileToken: string;
    }>();
    const email = normalizeEmail(body.email);
    const newsletterId =
      typeof body.newsletterId === "string" ? body.newsletterId.trim() : "";
    const turnstileToken =
      typeof body.turnstileToken === "string" ? body.turnstileToken.trim() : "";

    if (!email || !newsletterId || !turnstileToken) {
      return c.json(
        { error: "email, newsletterId and turnstileToken are required" },
        400,
      );
    }
    if (!isValidUuid(newsletterId)) {
      return c.json({ error: "Invalid newsletterId" }, 400);
    }

    const requestIp = getClientIp(c);
    const preTurnstileIpAllowed = await enforceRateLimit(c.env.DB, {
      bucket: "subscribe-cancellation-precheck-ip",
      key: requestIp,
      maxRequests: PRE_TURNSTILE_MAX_REQUESTS,
      windowSeconds: PRE_TURNSTILE_WINDOW_SECONDS,
    });
    if (!preTurnstileIpAllowed) {
      c.header("Retry-After", String(PRE_TURNSTILE_WINDOW_SECONDS));
      return c.json({ error: "Too many requests" }, 429);
    }

    const turnstilePassed = await verifyTurnstile(
      c.env,
      turnstileToken,
      requestIp,
    );
    if (!turnstilePassed) {
      return c.json({ error: "Bot verification failed" }, 403);
    }

    const newsletter = await c.env.DB.prepare(
      `SELECT id FROM Newsletter WHERE id = ?`,
    )
      .bind(newsletterId)
      .first<{ id: string }>();
    if (!newsletter) {
      return c.json({ error: "Newsletter not found" }, 404);
    }

    const ipAllowed = await enforceRateLimit(c.env.DB, {
      bucket: "subscribe-cancellation-ip",
      key: requestIp,
      maxRequests: POST_TURNSTILE_IP_MAX_REQUESTS,
      windowSeconds: POST_TURNSTILE_WINDOW_SECONDS,
    });
    if (!ipAllowed) {
      c.header("Retry-After", String(POST_TURNSTILE_WINDOW_SECONDS));
      return c.json({ error: "Too many requests" }, 429);
    }

    const targetAllowed = await enforceRateLimit(c.env.DB, {
      bucket: "subscribe-cancellation-target",
      key: `${newsletterId}:${email}`,
      maxRequests: POST_TURNSTILE_TARGET_MAX_REQUESTS,
      windowSeconds: POST_TURNSTILE_WINDOW_SECONDS,
    });
    if (!targetAllowed) {
      c.header("Retry-After", String(POST_TURNSTILE_WINDOW_SECONDS));
      return c.json({ error: "Too many requests" }, 429);
    }

    const token = crypto.randomUUID();
    const expiry = 60 * 60; // 1 hour in seconds

    // Store Token
    await c.env.KV.put(
      token,
      JSON.stringify({ action: "cancel", email, newsletterId }),
      { expirationTtl: expiry },
    );

    // Send Cancellation Email
    const cancellationUrl = `https://newsletter.habengirma.com/api/subscribe/cancel/${token}`;

    await sendEmail(
      c.env,
      email,
      "Cancel your subscription",
      `Please cancel your subscription by clicking the following link: ${cancellationUrl}`,
    );
    return c.json({ message: "Cancellation email sent" });
  } catch (error: unknown) {
    return internalServerError(c, "send-cancellation-email", error);
  }
});

app.post("/api/ses/sns/:token", async (c) => {
  const { token } = c.req.param();
  const webhookToken = normalizeNonEmptyString(c.env.SES_SNS_WEBHOOK_TOKEN);
  if (!webhookToken) {
    logError(
      "ses-sns-config",
      new Error("SES_SNS_WEBHOOK_TOKEN secret is not configured"),
    );
    return c.json({ error: "SES webhook unavailable" }, 503);
  }
  if (!timingSafeEqual(token, webhookToken)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const envelope = await c.req.json<SesSnsEnvelope>();
    const verified = await verifySnsEnvelopeSignature(envelope);
    if (!verified) {
      return c.json({ error: "Invalid SNS signature" }, 403);
    }

    const configuredTopicArn = normalizeNonEmptyString(c.env.SES_SNS_TOPIC_ARN);
    const topicArn =
      typeof envelope.TopicArn === "string" ? envelope.TopicArn : "";
    if (configuredTopicArn && topicArn !== configuredTopicArn) {
      return c.json({ error: "Unexpected SNS topic" }, 403);
    }

    if (envelope.Type === "SubscriptionConfirmation") {
      const confirmed = await confirmSnsSubscription(envelope);
      if (!confirmed) {
        return c.json({ error: "Invalid SNS subscription confirmation" }, 400);
      }
      console.log("[ses-sns] Subscription confirmed");
      return c.json({ message: "SNS subscription confirmed" });
    }

    if (envelope.Type !== "Notification" || typeof envelope.Message !== "string") {
      return c.json({ error: "Invalid SNS payload" }, 400);
    }

    const result = await processSesNotification(c.env, envelope.Message);
    return c.json({
      message: "SES notification processed",
      recordedCount: result.recordedCount,
      unsubscribedCount: result.unsubscribedCount,
    });
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return c.json({ error: "Invalid SNS payload" }, 400);
    }
    return internalServerError(c, "ses-sns-webhook", error);
  }
});

function getSesTagValue(
  tags: Record<string, unknown> | undefined,
  name: string,
): string | null {
  const value = tags?.[name];
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return typeof value === "string" ? value : null;
}

function getSesNotificationRecipients(notification: SesNotification): string[] {
  const notificationType =
    typeof notification.eventType === "string"
      ? notification.eventType
      : typeof notification.notificationType === "string"
        ? notification.notificationType
        : "";
  const recipientObjects =
    notificationType === "Complaint"
      ? notification.complaint?.complainedRecipients
      : notificationType === "DeliveryDelay"
        ? notification.deliveryDelay?.delayedRecipients
        : notificationType === "Delivery"
          ? notification.delivery?.recipients
          : notification.bounce?.bouncedRecipients;
  if (Array.isArray(recipientObjects)) {
    return recipientObjects
      .map((recipient) => {
        if (typeof recipient === "string") {
          return normalizeEmail(recipient);
        }
        if (
          recipient &&
          typeof recipient === "object" &&
          "emailAddress" in recipient
        ) {
          return normalizeEmail(
            (recipient as { emailAddress?: unknown }).emailAddress,
          );
        }
        return null;
      })
      .filter((email): email is string => Boolean(email));
  }

  const destinations = notification.mail?.destination;
  if (Array.isArray(destinations)) {
    return destinations
      .map((destination) => normalizeEmail(destination))
      .filter((email): email is string => Boolean(email));
  }

  return [];
}

async function recordSuppressionEvent(
  db: D1Database,
  event: {
    email: string;
    newsletterId: string | null;
    eventType: string;
    providerMessageId: string | null;
    providerPayload: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO SuppressionEvent (id, email, newsletter_id, event_type, provider_message_id, provider_payload, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      event.email,
      event.newsletterId,
      event.eventType,
      event.providerMessageId,
      event.providerPayload.slice(0, MAX_SUPPRESSION_PAYLOAD_LENGTH),
      new Date().toISOString(),
    )
    .run();
}

async function processSesNotification(
  env: Bindings,
  messageJson: string,
): Promise<{ recordedCount: number; unsubscribedCount: number }> {
  const notification = JSON.parse(messageJson) as SesNotification;
  const notificationType =
    typeof notification.eventType === "string"
      ? notification.eventType
      : typeof notification.notificationType === "string"
        ? notification.notificationType
        : "";
  const trackedTypes = new Set([
    "Send",
    "Reject",
    "Delivery",
    "DeliveryDelay",
    "Bounce",
    "Complaint",
  ]);
  if (!trackedTypes.has(notificationType)) {
    return { recordedCount: 0, unsubscribedCount: 0 };
  }

  const bounceType =
    typeof notification.bounce?.bounceType === "string"
      ? notification.bounce.bounceType
      : "";
  const shouldUnsubscribe =
    notificationType === "Complaint" ||
    (notificationType === "Bounce" && bounceType === "Permanent");
  const newsletterTag = getSesTagValue(notification.mail?.tags, "newsletterId");
  const newsletterId =
    newsletterTag && isValidUuid(newsletterTag) ? newsletterTag : null;
  const sendTag = getSesTagValue(notification.mail?.tags, "sendId");
  const sendId = sendTag && isValidUuid(sendTag) ? sendTag : null;
  const recipientHash = getSesTagValue(notification.mail?.tags, "recipientHash");
  const providerMessageId =
    typeof notification.mail?.messageId === "string"
      ? notification.mail.messageId
      : null;
  const eventType = (() => {
    switch (notificationType) {
      case "Complaint":
        return "complaint";
      case "Bounce":
        return `bounce:${bounceType || "unknown"}`;
      case "DeliveryDelay":
        return "deliveryDelayed";
      case "Delivery":
        return "delivered";
      case "Reject":
        return "rejected";
      case "Send":
        return "providerSend";
      default:
        return notificationType;
    }
  })();
  const recipients = getSesNotificationRecipients(notification);
  const providerPayload = JSON.stringify(notification);

  if (newsletterId && sendId && recipientHash) {
    const status = (() => {
      switch (notificationType) {
        case "Send":
          return "providerAccepted";
        case "Delivery":
          return "delivered";
        case "DeliveryDelay":
          return "deliveryDelayed";
        case "Bounce":
          return "bounced";
        case "Complaint":
          return "complained";
        case "Reject":
          return "failed";
        default:
          return null;
      }
    })() as NewsletterSendRecipientStatus | null;
    if (status) {
      const detail =
        notificationType === "Reject"
          ? asNullableString(notification.reject?.reason)
          : notificationType === "DeliveryDelay"
            ? asNullableString(notification.deliveryDelay?.delayType)
            : notificationType === "Bounce"
              ? bounceType || null
              : null;
      await updateNewsletterSendRecipientStatus(env, {
        sendId,
        newsletterId,
        recipientHash,
        status,
        eventType,
        message: detail,
        providerMessageId,
        providerPayload,
        failureType: notificationType === "Reject" ? "provider" : null,
      });
    }
  }

  let recordedCount = 0;
  let unsubscribedCount = 0;
  for (const email of recipients) {
    if (notificationType === "Bounce" || notificationType === "Complaint") {
      await recordSuppressionEvent(env.DB, {
        email,
        newsletterId,
        eventType,
        providerMessageId,
        providerPayload,
      });
      recordedCount += 1;
    }

    if (shouldUnsubscribe && newsletterId) {
      await markSubscriberUnsubscribed(env.DB, email, newsletterId);
      unsubscribedCount += 1;
    }
  }

  return { recordedCount, unsubscribedCount };
}

const sendEmail = async (
  env: Bindings,
  email: string,
  subject: string,
  txt: string,
  html: string = "",
  options: SendEmailOptions = {},
): Promise<string | undefined> => {
  const body: {
    mail_to: string;
    subject: string;
    txt: string;
    html: string;
    from_name?: string;
    headers?: EmailHeader[];
    tags?: EmailTag[];
    idempotency_key?: string;
  } = { mail_to: email, subject, txt, html };

  const fromName = normalizeFromNameForStorage(options.fromName ?? null);
  if (fromName.ok && fromName.fromName) {
    body.from_name = fromName.fromName;
  }
  if (options.headers && options.headers.length > 0) {
    body.headers = options.headers;
  }
  if (options.tags && options.tags.length > 0) {
    body.tags = options.tags;
  }
  const idempotencyKey = normalizeNonEmptyString(options.idempotencyKey);
  if (idempotencyKey) {
    body.idempotency_key = idempotencyKey;
  }

  const notificationSharedSecret = getNotificationSharedSecret(env);
  if (!notificationSharedSecret) {
    throw new Error("NOTIFICATION_SHARED_SECRET secret is not configured");
  }

  const request = new Request(`${NOTIFICATION_BASE_URL}/send_email`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      [NOTIFICATION_AUTH_HEADER]: notificationSharedSecret,
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
  });

  let res: Response;
  try {
    res = await env.NOTIFICATION.fetch(request);
  } catch (error: unknown) {
    throw new NotificationServiceError(
      errorMessage(error, `Notification service request failed for ${email}`),
      null,
      false,
      true,
    );
  }

  if (!res.ok) {
    const errorMetadata = await parseNotificationErrorResponse(res);
    throw new NotificationServiceError(
      `Notification service returned status ${res.status}`,
      res.status,
      errorMetadata.retryable ?? isRetryableNotificationStatus(res.status),
      errorMetadata.providerContacted ?? true,
      errorMetadata.retryDelaySeconds,
    );
  }

  const responseBody = await res.json<unknown>().catch(() => null);
  const { message, messageId } = responseBody && typeof responseBody === "object"
    ? responseBody as { message?: string; messageId?: string }
    : {};

  if (message !== "success") {
    throw new NotificationServiceError(
      `Failed to send email to ${email}`,
      null,
      false,
      true,
    );
  }

  return messageId;
};

// Public Page for viewing Newsletters
app.get("/newsletter/:newsletterId", async (c) => {
  const { newsletterId } = c.req.param();

  try {
    const newsletter = await c.env.DB.prepare(
      `SELECT * FROM Newsletter WHERE id = ?`,
    )
      .bind(newsletterId)
      .first();

    if (!newsletter) {
      return c.html("<h1>Newsletter not found</h1>", 404);
    }

    if (!newsletter.subscribable) {
      return c.html("<h1>Newsletter is not subscribable</h1>", 404);
    }

    const safeTitle = escapeHtml(newsletter.title as string);
    const safeDescription = escapeHtml(newsletter.description as string);
    const safeLogo = escapeHtml((newsletter.logo as string) || "");
    const safeNewsletterId = escapeHtml(newsletterId);
    const safeTurnstileSiteKey = escapeHtml(c.env.TURNSTILE_SITE_KEY || "");

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
    `;

    return c.html(html);
  } catch (error: unknown) {
    logError("render-newsletter-page", error);
    return c.html("<h1>Internal server error</h1>", 500);
  }
});

// Common Functions

function renderHtml(
  c: AppContext,
  englishMessage: string,
  chineseMessage: string = englishMessage,
) {
  const language = c.req
    .header("Accept-Language")
    ?.toLowerCase()
    .startsWith("zh")
    ? "zh"
    : "en";
  const message = language === "zh" ? chineseMessage : englishMessage;
  const safeMessage = escapeHtml(message);
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
  `;

  return c.html(html);
}

function renderUnsubscribeConfirmationHtml(c: AppContext, token: string) {
  const language = c.req
    .header("Accept-Language")
    ?.toLowerCase()
    .startsWith("zh")
    ? "zh"
    : "en";
  const title =
    language === "zh" ? "确认取消订阅" : "Confirm unsubscribe";
  const description =
    language === "zh"
      ? "请选择下方按钮以取消订阅。"
      : "Choose the button below to unsubscribe.";
  const buttonLabel = language === "zh" ? "取消订阅" : "Unsubscribe";
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeButtonLabel = escapeHtml(buttonLabel);
  const safeAction = `/api/subscribe/unsubscribe/${escapeHtml(token)}`;
  const html = `
    <!DOCTYPE html>
    <html lang="${language}">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${safeTitle}</title>
      </head>
      <body>
        <h1>${safeTitle}</h1>
        <p>${safeDescription}</p>
        <form method="post" action="${safeAction}">
          <button type="submit">${safeButtonLabel}</button>
        </form>
      </body>
    </html>
  `;

  return c.html(html);
}

const streamToArrayBuffer = async function (
  stream: ReadableStream,
  streamSize: number,
) {
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
};

async function countSubscribedSubscribers(
  newsletterId: string,
  db: D1Database,
  snapshotAt: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS subscriberCount
       FROM Subscriber
       WHERE newsletter_id = ?
         AND COALESCE(subscribed_at, upsertedAt, '1970-01-01T00:00:00.000Z') <= ?
         AND (unsubscribed_at IS NULL OR unsubscribed_at > ?)
         AND (deleted_at IS NULL OR deleted_at > ?)`,
    )
    .bind(newsletterId, snapshotAt, snapshotAt, snapshotAt)
    .first<Record<string, unknown>>();
  return asNumber(row?.subscriberCount);
}

async function getSubscribedSubscriberPage(
  newsletterId: string,
  db: D1Database,
  cursorEmail: string | null,
  limit: number,
  snapshotAt: string,
): Promise<{ email: string }[]> {
  const params: unknown[] = [newsletterId, snapshotAt, snapshotAt, snapshotAt];
  let cursorPredicate = "";
  if (cursorEmail) {
    cursorPredicate = "AND email COLLATE NOCASE > ?";
    params.push(cursorEmail);
  }
  params.push(limit);

  const { results } = await db
    .prepare(
      `SELECT email
       FROM Subscriber
       WHERE newsletter_id = ?
         AND COALESCE(subscribed_at, upsertedAt, '1970-01-01T00:00:00.000Z') <= ?
         AND (unsubscribed_at IS NULL OR unsubscribed_at > ?)
         AND (deleted_at IS NULL OR deleted_at > ?)
       ${cursorPredicate}
       ORDER BY email COLLATE NOCASE
       LIMIT ?`,
    )
    .bind(...params)
    .all<Record<string, unknown>>();
  return results.map((row) => ({ email: String(row.email ?? "") }));
}

async function markSubscriberUnsubscribed(
  db: D1Database,
  email: string,
  newsletterId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE Subscriber
       SET isSubscribed = 0,
           upsertedAt = ?,
           unsubscribed_at = COALESCE(unsubscribed_at, ?)
       WHERE email = ? AND newsletter_id = ?`,
    )
    .bind(now, now, email, newsletterId)
    .run();
}

function appendUnsubscribeFooterToHtml(
  html: string,
  unsubscribeUrl: string,
): string {
  const safeUrl = escapeHtml(unsubscribeUrl);
  const footer = [
    "<hr>",
    "<p style=\"font-size: 12px; color: #555;\">",
    "You are receiving this email because you subscribed to this newsletter. ",
    `<a href="${safeUrl}">Unsubscribe</a>`,
    "</p>",
  ].join("");

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${footer}</body>`);
  }
  return `${html}${footer}`;
}

function appendUnsubscribeFooterToText(
  text: string,
  unsubscribeUrl: string,
): string {
  const body = text.trimEnd();
  const footer = `\n\n--\nYou are receiving this email because you subscribed to this newsletter.\nUnsubscribe: ${unsubscribeUrl}`;
  return `${body}${footer}`;
}

function buildNewsletterListHeaders(
  newsletterId: string,
  recipientHash: string,
  oneClickUrl: string,
  sendId?: string,
): EmailHeader[] {
  const headers = [
    { name: "List-Unsubscribe", value: `<${oneClickUrl}>` },
    {
      name: "List-Unsubscribe-Post",
      value: "List-Unsubscribe=One-Click",
    },
    {
      name: "List-ID",
      value: `LetterDrop Newsletter ${newsletterId} <${newsletterId}.newsletter.habengirma.com>`,
    },
    { name: "X-Newsletter-ID", value: newsletterId },
    { name: "X-Recipient-Hash", value: recipientHash },
  ];
  if (sendId) {
    headers.push({ name: "X-LetterDrop-Send-ID", value: sendId });
  }
  return headers;
}

function buildNewsletterEmailTags(
  newsletterId: string,
  recipientHash: string,
  sendId?: string,
): EmailTag[] {
  const tags = [
    { name: "newsletterId", value: newsletterId },
    { name: "recipientHash", value: recipientHash },
  ];
  if (sendId) {
    tags.push({ name: "sendId", value: sendId });
  }
  return tags;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function boundedInt(
  value: unknown,
  defaultValue: number,
  minValue: number,
  maxValue: number,
): number {
  const parsed =
    typeof value === "string" && value.trim().length > 0
      ? Number(value)
      : typeof value === "number"
        ? value
        : NaN;
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(maxValue, Math.max(minValue, Math.floor(parsed)));
}

function isNewsletterSendRecipientStatus(
  value: string | null | undefined,
): value is NewsletterSendRecipientStatus {
  return (
    value === "queued" ||
    value === "sending" ||
    value === "providerAccepted" ||
    value === "deliveryDelayed" ||
    value === "delivered" ||
    value === "bounced" ||
    value === "complained" ||
    value === "retrying" ||
    value === "failed" ||
    value === "deadLettered" ||
    value === "needsReview"
  );
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

class NotificationServiceError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly providerContacted: boolean,
    readonly retryDelaySeconds: number | null = null,
  ) {
    super(message);
  }
}

function isRetryableNotificationStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function retryDelaySecondsFromValue(value: unknown): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value)
      : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.max(1, Math.ceil(parsed));
}

async function parseNotificationErrorResponse(
  response: Response,
): Promise<{
  retryable?: boolean;
  providerContacted?: boolean;
  retryDelaySeconds: number | null;
}> {
  const retryHeaderDelay = retryDelaySecondsFromValue(response.headers.get("Retry-After"));
  const body = await response.json<unknown>().catch(() => null);
  if (!body || typeof body !== "object") {
    return { retryDelaySeconds: retryHeaderDelay };
  }
  const metadata = body as {
    retryable?: unknown;
    providerContacted?: unknown;
    retryAfterSeconds?: unknown;
  };
  return {
    retryable: typeof metadata.retryable === "boolean" ? metadata.retryable : undefined,
    providerContacted: typeof metadata.providerContacted === "boolean"
      ? metadata.providerContacted
      : undefined,
    retryDelaySeconds:
      retryDelaySecondsFromValue(metadata.retryAfterSeconds) ?? retryHeaderDelay,
  };
}

function shouldRetryRecipientError(error: unknown): boolean {
  if (error instanceof NotificationServiceError) {
    if (
      error.providerContacted &&
      error.status !== 408 &&
      error.status !== 409 &&
      error.status !== 425 &&
      error.status !== 429
    ) {
      return false;
    }
    return error.retryable;
  }
  return true;
}

function retryDelaySecondsForRecipientError(error: unknown): number {
  if (error instanceof NotificationServiceError && error.retryDelaySeconds) {
    return error.retryDelaySeconds;
  }
  return NEWSLETTER_QUEUE_RETRY_DELAY_SECONDS;
}

function isFanoutQueueMessage(
  message: NewsletterQueueMessage,
): message is NewsletterFanoutQueueMessage {
  return "kind" in message && message.kind === "fanout";
}

function isRecipientBatchQueueMessage(
  message: NewsletterQueueMessage,
): message is NewsletterRecipientBatchQueueMessage {
  return "kind" in message && message.kind === "recipientBatch";
}

function mapNewsletterSendSummary(row: Record<string, unknown>): NewsletterSendSummary {
  return {
    id: String(row.id ?? ""),
    newsletterId: String(row.newsletterId ?? row.newsletter_id ?? ""),
    subject: String(row.subject ?? ""),
    sourceMessageId: asNullableString(row.sourceMessageId ?? row.source_message_id),
    status: String(row.status ?? "queued") as NewsletterSendStatus,
    recipientCount: asNumber(row.recipientCount ?? row.recipient_count),
    queuedCount: asNumber(row.queuedCount ?? row.queued_count),
    fanoutQueuedCount: asNumber(row.fanoutQueuedCount ?? row.fanout_queued_count),
    sendingCount: asNumber(row.sendingCount ?? row.sending_count),
    retryingCount: asNumber(row.retryingCount ?? row.retrying_count),
    queueFailedCount: asNumber(row.queueFailedCount ?? row.queue_failed_count),
    providerAcceptedCount: asNumber(row.providerAcceptedCount ?? row.provider_accepted_count),
    deliveredCount: asNumber(row.deliveredCount ?? row.delivered_count),
    deliveryDelayedCount: asNumber(row.deliveryDelayedCount ?? row.delivery_delayed_count),
    bouncedCount: asNumber(row.bouncedCount ?? row.bounced_count),
    complainedCount: asNumber(row.complainedCount ?? row.complained_count),
    failedCount: asNumber(row.failedCount ?? row.failed_count),
    deadLetteredCount: asNumber(row.deadLetteredCount ?? row.dead_lettered_count),
    needsReviewCount: asNumber(row.needsReviewCount ?? row.needs_review_count),
    lastError: asNullableString(row.lastError ?? row.last_error),
    contentFileName: asNullableString(row.contentFileName ?? row.content_file_name),
    textFileName: asNullableString(row.textFileName ?? row.text_file_name),
    fromName: asNullableString(row.fromName ?? row.from_name),
    fanoutSnapshotAt: asNullableString(row.fanoutSnapshotAt ?? row.fanout_snapshot_at),
    fanoutCursorEmail: asNullableString(row.fanoutCursorEmail ?? row.fanout_cursor_email),
    fanoutCompletedAt: asNullableString(row.fanoutCompletedAt ?? row.fanout_completed_at),
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
    completedAt: asNullableString(row.completedAt ?? row.completed_at),
  };
}

function mapNewsletterDraftSummary(row: Record<string, unknown>): NewsletterDraftSummary {
  const status = String(row.status ?? "draft") === "sent" ? "sent" : "draft";
  return {
    id: String(row.id ?? ""),
    newsletterId: String(row.newsletterId ?? row.newsletter_id ?? ""),
    subject: String(row.subject ?? ""),
    sourceMessageId: String(row.sourceMessageId ?? row.source_message_id ?? ""),
    contentFileName: String(row.contentFileName ?? row.content_file_name ?? ""),
    textFileName: String(row.textFileName ?? row.text_file_name ?? ""),
    status,
    sendId: asNullableString(row.sendId ?? row.send_id),
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
    sentAt: asNullableString(row.sentAt ?? row.sent_at),
  };
}

async function readR2Text(env: Bindings, key: string | null): Promise<string | null> {
  if (!key) {
    return null;
  }
  const object = await env.R2.get(key);
  return object ? object.text() : null;
}

async function newsletterExists(db: D1Database, newsletterId: string): Promise<boolean> {
  const newsletter = await db
    .prepare(`SELECT id FROM Newsletter WHERE id = ?`)
    .bind(newsletterId)
    .first<{ id: string }>();
  return Boolean(newsletter);
}

function draftContentFileName(newsletterId: string, draftId: string): string {
  return `newsletters/${newsletterId}/drafts/${draftId}.html`;
}

function draftTextFileName(newsletterId: string, draftId: string): string {
  return `newsletters/${newsletterId}/drafts/${draftId}.txt`;
}

function draftStringField(
  body: Record<string, unknown>,
  field: string,
  fallback: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = body[field];
  if (value === undefined || value === null) {
    return { ok: true, value: fallback };
  }
  if (typeof value !== "string") {
    return { ok: false, error: `${field} must be a string` };
  }
  return { ok: true, value };
}

async function listNewsletterDraftSummaries(
  db: D1Database,
  newsletterId: string,
): Promise<NewsletterDraftSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT id,
              newsletter_id AS newsletterId,
              subject,
              source_message_id AS sourceMessageId,
              content_file_name AS contentFileName,
              text_file_name AS textFileName,
              status,
              send_id AS sendId,
              createdAt,
              updatedAt,
              sentAt
       FROM NewsletterDraft
       WHERE newsletter_id = ? AND status = 'draft'
       ORDER BY updatedAt DESC
       LIMIT 50`,
    )
    .bind(newsletterId)
    .all<Record<string, unknown>>();
  return results.map(mapNewsletterDraftSummary);
}

async function getNewsletterDraftSummary(
  db: D1Database,
  draftId: string,
): Promise<NewsletterDraftSummary | null> {
  const row = await db
    .prepare(
      `SELECT id,
              newsletter_id AS newsletterId,
              subject,
              source_message_id AS sourceMessageId,
              content_file_name AS contentFileName,
              text_file_name AS textFileName,
              status,
              send_id AS sendId,
              createdAt,
              updatedAt,
              sentAt
       FROM NewsletterDraft
       WHERE id = ?`,
    )
    .bind(draftId)
    .first<Record<string, unknown>>();
  return row ? mapNewsletterDraftSummary(row) : null;
}

async function getNewsletterDraftBySourceMessageId(
  db: D1Database,
  newsletterId: string,
  sourceMessageId: string,
): Promise<NewsletterDraftSummary | null> {
  const row = await db
    .prepare(
      `SELECT id,
              newsletter_id AS newsletterId,
              subject,
              source_message_id AS sourceMessageId,
              content_file_name AS contentFileName,
              text_file_name AS textFileName,
              status,
              send_id AS sendId,
              createdAt,
              updatedAt,
              sentAt
       FROM NewsletterDraft
       WHERE newsletter_id = ? AND source_message_id = ?
       LIMIT 1`,
    )
    .bind(newsletterId, sourceMessageId)
    .first<Record<string, unknown>>();
  return row ? mapNewsletterDraftSummary(row) : null;
}

async function getNewsletterDraftContent(
  env: Bindings,
  draft: NewsletterDraftSummary,
): Promise<NewsletterDraftContent | null> {
  const [html, text] = await Promise.all([
    readR2Text(env, draft.contentFileName),
    readR2Text(env, draft.textFileName),
  ]);
  if (html === null || text === null) {
    return null;
  }
  return { draft, html, text };
}

async function createNewsletterDraft(
  env: Bindings,
  input: {
    newsletterId: string;
    subject: string;
    html: string;
    text: string;
    sourceMessageId?: string | null;
  },
): Promise<NewsletterDraftSummary> {
  const draftId = crypto.randomUUID();
  const now = new Date().toISOString();
  const contentFileName = draftContentFileName(input.newsletterId, draftId);
  const textFileName = draftTextFileName(input.newsletterId, draftId);
  const requestedSourceMessageId = normalizeNonEmptyString(input.sourceMessageId);
  const sourceMessageId = requestedSourceMessageId ?? `draft:${draftId}`;

  const existingDraft = requestedSourceMessageId
    ? await getNewsletterDraftBySourceMessageId(
      env.DB,
      input.newsletterId,
      sourceMessageId,
    )
    : null;
  if (existingDraft) {
    if (existingDraft.status !== "draft") {
      throw new NewsletterDraftSourceConflictError();
    }
    return updateNewsletterDraft(env, existingDraft, input);
  }

  await Promise.all([
    env.R2.put(contentFileName, input.html),
    env.R2.put(textFileName, input.text),
  ]);

  try {
    await env.DB.prepare(
      `INSERT INTO NewsletterDraft (
         id, newsletter_id, subject, source_message_id, content_file_name,
         text_file_name, status, send_id, createdAt, updatedAt, sentAt
       )
       VALUES (?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?, NULL)`,
    )
      .bind(
        draftId,
        input.newsletterId,
        input.subject,
        sourceMessageId,
        contentFileName,
        textFileName,
        now,
        now,
      )
      .run();
  } catch (error: unknown) {
    await Promise.allSettled([
      env.R2.delete(contentFileName),
      env.R2.delete(textFileName),
    ]);
    if (isNewsletterDraftSourceUniqueError(error)) {
      const conflictingDraft = await getNewsletterDraftBySourceMessageId(
        env.DB,
        input.newsletterId,
        sourceMessageId,
      );
      if (conflictingDraft?.status === "draft") {
        return updateNewsletterDraft(env, conflictingDraft, input);
      }
      if (conflictingDraft) {
        throw new NewsletterDraftSourceConflictError();
      }
    }
    throw error;
  }

  const draft = await getNewsletterDraftSummary(env.DB, draftId);
  if (!draft) {
    throw new Error("Failed to create newsletter draft");
  }
  return draft;
}

function isNewsletterDraftSourceUniqueError(error: unknown): boolean {
  return error instanceof Error &&
    error.message.includes("NewsletterDraft.newsletter_id") &&
    error.message.includes("NewsletterDraft.source_message_id");
}

async function updateNewsletterDraft(
  env: Bindings,
  draft: NewsletterDraftSummary,
  input: { subject: string; html: string; text: string },
): Promise<NewsletterDraftSummary> {
  const now = new Date().toISOString();
  await Promise.all([
    env.R2.put(draft.contentFileName, input.html),
    env.R2.put(draft.textFileName, input.text),
  ]);
  await env.DB.prepare(
    `UPDATE NewsletterDraft
     SET subject = ?,
         updatedAt = ?
     WHERE id = ? AND status = 'draft'`,
  )
    .bind(input.subject, now, draft.id)
    .run();
  const updated = await getNewsletterDraftSummary(env.DB, draft.id);
  if (!updated) {
    throw new Error("Failed to update newsletter draft");
  }
  return updated;
}

async function markNewsletterDraftSent(
  db: D1Database,
  draftId: string,
  sendId: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE NewsletterDraft
       SET status = 'sent',
           send_id = ?,
           sentAt = ?,
           updatedAt = ?
       WHERE id = ? AND status = 'draft'`,
    )
    .bind(sendId, now, now, draftId)
    .run();
}

function mapNewsletterSendRecipient(row: Record<string, unknown>): NewsletterSendRecipient {
  return {
    id: String(row.id ?? ""),
    sendId: String(row.sendId ?? row.send_id ?? ""),
    newsletterId: String(row.newsletterId ?? row.newsletter_id ?? ""),
    email: String(row.email ?? ""),
    recipientHash: String(row.recipientHash ?? row.recipient_hash ?? ""),
    status: String(row.status ?? "queued") as NewsletterSendRecipientStatus,
    attempts: asNumber(row.attempts),
    failureType: asNullableString(row.failureType ?? row.failure_type),
    providerMessageId: asNullableString(row.providerMessageId ?? row.provider_message_id),
    lastError: asNullableString(row.lastError ?? row.last_error),
    queuedAt: asNullableString(row.queuedAt ?? row.queued_at),
    sendingAt: asNullableString(row.sendingAt ?? row.sending_at),
    providerAcceptedAt: asNullableString(row.providerAcceptedAt ?? row.provider_accepted_at),
    deliveryDelayedAt: asNullableString(row.deliveryDelayedAt ?? row.delivery_delayed_at),
    deliveredAt: asNullableString(row.deliveredAt ?? row.delivered_at),
    bouncedAt: asNullableString(row.bouncedAt ?? row.bounced_at),
    complainedAt: asNullableString(row.complainedAt ?? row.complained_at),
    failedAt: asNullableString(row.failedAt ?? row.failed_at),
    deadLetteredAt: asNullableString(row.deadLetteredAt ?? row.dead_lettered_at),
    needsReviewAt: asNullableString(row.needsReviewAt ?? row.needs_review_at),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

function mapNewsletterSendEvent(row: Record<string, unknown>): NewsletterSendEvent {
  return {
    id: asNumber(row.id),
    sendId: String(row.sendId ?? row.send_id ?? ""),
    newsletterId: String(row.newsletterId ?? row.newsletter_id ?? ""),
    recipientId: asNullableString(row.recipientId ?? row.recipient_id),
    recipientHash: asNullableString(row.recipientHash ?? row.recipient_hash),
    email: asNullableString(row.email),
    eventType: String(row.eventType ?? row.event_type ?? ""),
    recipientStatus: asNullableString(row.recipientStatus ?? row.recipient_status) as
      | NewsletterSendRecipientStatus
      | null,
    sendStatus: asNullableString(row.sendStatus ?? row.send_status) as
      | NewsletterSendStatus
      | null,
    message: asNullableString(row.message),
    providerMessageId: asNullableString(row.providerMessageId ?? row.provider_message_id),
    createdAt: String(row.createdAt ?? ""),
  };
}

async function getNewsletterSendSummary(
  db: D1Database,
  sendId: string,
): Promise<NewsletterSendSummary | null> {
  const row = await db
    .prepare(
      `SELECT id,
              newsletter_id AS newsletterId,
              subject,
              source_message_id AS sourceMessageId,
              status,
              recipient_count AS recipientCount,
              queued_count AS queuedCount,
              fanout_queued_count AS fanoutQueuedCount,
              sending_count AS sendingCount,
              retrying_count AS retryingCount,
              queue_failed_count AS queueFailedCount,
              provider_accepted_count AS providerAcceptedCount,
              delivered_count AS deliveredCount,
              delivery_delayed_count AS deliveryDelayedCount,
              bounced_count AS bouncedCount,
              complained_count AS complainedCount,
              failed_count AS failedCount,
              dead_lettered_count AS deadLetteredCount,
              needs_review_count AS needsReviewCount,
              last_error AS lastError,
              content_file_name AS contentFileName,
              text_file_name AS textFileName,
              from_name AS fromName,
              fanout_snapshot_at AS fanoutSnapshotAt,
              fanout_cursor_email AS fanoutCursorEmail,
              fanout_completed_at AS fanoutCompletedAt,
              createdAt,
              updatedAt,
              completedAt
       FROM NewsletterSend
       WHERE id = ?`,
    )
    .bind(sendId)
    .first<Record<string, unknown>>();
  return row ? mapNewsletterSendSummary(row) : null;
}

async function getNewsletterSendSummaryBySourceMessage(
  db: D1Database,
  newsletterId: string,
  sourceMessageId: string,
): Promise<NewsletterSendSummary | null> {
  const row = await db
    .prepare(
      `SELECT id,
              newsletter_id AS newsletterId,
              subject,
              source_message_id AS sourceMessageId,
              status,
              recipient_count AS recipientCount,
              queued_count AS queuedCount,
              fanout_queued_count AS fanoutQueuedCount,
              sending_count AS sendingCount,
              retrying_count AS retryingCount,
              queue_failed_count AS queueFailedCount,
              provider_accepted_count AS providerAcceptedCount,
              delivered_count AS deliveredCount,
              delivery_delayed_count AS deliveryDelayedCount,
              bounced_count AS bouncedCount,
              complained_count AS complainedCount,
              failed_count AS failedCount,
              dead_lettered_count AS deadLetteredCount,
              needs_review_count AS needsReviewCount,
              last_error AS lastError,
              content_file_name AS contentFileName,
              text_file_name AS textFileName,
              from_name AS fromName,
              fanout_snapshot_at AS fanoutSnapshotAt,
              fanout_cursor_email AS fanoutCursorEmail,
              fanout_completed_at AS fanoutCompletedAt,
              createdAt,
              updatedAt,
              completedAt
       FROM NewsletterSend
       WHERE newsletter_id = ? AND source_message_id = ?
       ORDER BY createdAt ASC
       LIMIT 1`,
    )
    .bind(newsletterId, sourceMessageId)
    .first<Record<string, unknown>>();
  return row ? mapNewsletterSendSummary(row) : null;
}

async function getNewsletterSendRecipientByHash(
  db: D1Database,
  sendId: string,
  recipientHash: string,
): Promise<NewsletterSendRecipient | null> {
  const row = await db
    .prepare(
      `SELECT id,
              send_id AS sendId,
              newsletter_id AS newsletterId,
              email,
              recipient_hash AS recipientHash,
              status,
              attempts,
              failure_type AS failureType,
              provider_message_id AS providerMessageId,
              last_error AS lastError,
              queuedAt,
              sendingAt,
              providerAcceptedAt,
              deliveryDelayedAt,
              deliveredAt,
              bouncedAt,
              complainedAt,
              failedAt,
              deadLetteredAt,
              needsReviewAt,
              updatedAt
       FROM NewsletterSendRecipient
       WHERE send_id = ? AND recipient_hash = ?`,
    )
    .bind(sendId, recipientHash)
    .first<Record<string, unknown>>();
  return row ? mapNewsletterSendRecipient(row) : null;
}

async function getNewsletterSendRecipientsPage(
  db: D1Database,
  sendId: string,
  options: {
    cursorEmail?: string | null;
    limit?: number;
    status?: NewsletterSendRecipientStatus | null;
    query?: string | null;
  } = {},
): Promise<{
  recipients: NewsletterSendRecipient[];
  pagination: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}> {
  const limit = boundedInt(
    options.limit,
    NEWSLETTER_SEND_RECIPIENT_PAGE_SIZE,
    1,
    NEWSLETTER_SEND_MAX_RECIPIENT_PAGE_SIZE,
  );
  const params: unknown[] = [sendId];
  const predicates = ["send_id = ?"];
  const cursorEmail = normalizeNonEmptyString(options.cursorEmail);
  if (cursorEmail) {
    predicates.push("email COLLATE NOCASE > ?");
    params.push(cursorEmail);
  }
  if (options.status && isNewsletterSendRecipientStatus(options.status)) {
    predicates.push("status = ?");
    params.push(options.status);
  }
  const query = normalizeNonEmptyString(options.query);
  if (query) {
    predicates.push("email LIKE ? ESCAPE '\\'");
    params.push(likePattern(query));
  }
  params.push(limit + 1);

  const { results } = await db
    .prepare(
      `SELECT id,
              send_id AS sendId,
              newsletter_id AS newsletterId,
              email,
              recipient_hash AS recipientHash,
              status,
              attempts,
              failure_type AS failureType,
              provider_message_id AS providerMessageId,
              last_error AS lastError,
              queuedAt,
              sendingAt,
              providerAcceptedAt,
              deliveryDelayedAt,
              deliveredAt,
              bouncedAt,
              complainedAt,
              failedAt,
              deadLetteredAt,
              needsReviewAt,
              updatedAt
       FROM NewsletterSendRecipient
       WHERE ${predicates.join(" AND ")}
       ORDER BY email COLLATE NOCASE
       LIMIT ?`,
    )
    .bind(...params)
    .all<Record<string, unknown>>();
  const page = results.slice(0, limit).map(mapNewsletterSendRecipient);
  const hasMore = results.length > limit;
  return {
    recipients: page,
    pagination: {
      limit,
      nextCursor: hasMore && page.length > 0 ? page[page.length - 1].email : null,
      hasMore,
    },
  };
}

async function getNewsletterSendEvents(
  db: D1Database,
  sendId: string,
  afterEventId = 0,
  limit = NEWSLETTER_SEND_EVENT_PAGE_SIZE,
): Promise<NewsletterSendEvent[]> {
  const boundedLimit = boundedInt(limit, NEWSLETTER_SEND_EVENT_PAGE_SIZE, 1, NEWSLETTER_SEND_EVENT_PAGE_SIZE);
  const { results } = await db
    .prepare(
      `SELECT id,
              send_id AS sendId,
              newsletter_id AS newsletterId,
              recipient_id AS recipientId,
              recipient_hash AS recipientHash,
              email,
              event_type AS eventType,
              recipient_status AS recipientStatus,
              send_status AS sendStatus,
              message,
              provider_message_id AS providerMessageId,
              createdAt
       FROM NewsletterSendEvent
       WHERE send_id = ? AND id > ?
       ORDER BY id ASC
       LIMIT ?`,
    )
    .bind(sendId, afterEventId, boundedLimit)
    .all<Record<string, unknown>>();
  return results.map(mapNewsletterSendEvent);
}

async function getLatestNewsletterSendEvents(
  db: D1Database,
  sendId: string,
  limit: number,
): Promise<NewsletterSendEvent[]> {
  const boundedLimit = boundedInt(limit, 100, 1, NEWSLETTER_SEND_EVENT_PAGE_SIZE);
  const { results } = await db
    .prepare(
      `SELECT id,
              send_id AS sendId,
              newsletter_id AS newsletterId,
              recipient_id AS recipientId,
              recipient_hash AS recipientHash,
              email,
              event_type AS eventType,
              recipient_status AS recipientStatus,
              send_status AS sendStatus,
              message,
              provider_message_id AS providerMessageId,
              createdAt
       FROM NewsletterSendEvent
       WHERE send_id = ?
       ORDER BY id DESC
       LIMIT ?`,
    )
    .bind(sendId, boundedLimit)
    .all<Record<string, unknown>>();
  return results.map(mapNewsletterSendEvent).sort((lhs, rhs) => lhs.id - rhs.id);
}

async function getNewsletterSendLastEventId(
  db: D1Database,
  sendId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(MAX(id), 0) AS lastEventId
       FROM NewsletterSendEvent
       WHERE send_id = ?`,
    )
    .bind(sendId)
    .first<Record<string, unknown>>();
  return asNumber(row?.lastEventId);
}

async function listNewsletterSendSummaries(
  db: D1Database,
  newsletterId: string,
): Promise<NewsletterSendSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT id,
              newsletter_id AS newsletterId,
              subject,
              source_message_id AS sourceMessageId,
              status,
              recipient_count AS recipientCount,
              queued_count AS queuedCount,
              fanout_queued_count AS fanoutQueuedCount,
              sending_count AS sendingCount,
              retrying_count AS retryingCount,
              queue_failed_count AS queueFailedCount,
              provider_accepted_count AS providerAcceptedCount,
              delivered_count AS deliveredCount,
              delivery_delayed_count AS deliveryDelayedCount,
              bounced_count AS bouncedCount,
              complained_count AS complainedCount,
              failed_count AS failedCount,
              dead_lettered_count AS deadLetteredCount,
              needs_review_count AS needsReviewCount,
              last_error AS lastError,
              content_file_name AS contentFileName,
              text_file_name AS textFileName,
              from_name AS fromName,
              fanout_snapshot_at AS fanoutSnapshotAt,
              fanout_cursor_email AS fanoutCursorEmail,
              fanout_completed_at AS fanoutCompletedAt,
              createdAt,
              updatedAt,
              completedAt
       FROM NewsletterSend
       WHERE newsletter_id = ?
       ORDER BY createdAt DESC
       LIMIT 50`,
    )
    .bind(newsletterId)
    .all<Record<string, unknown>>();
  return results.map(mapNewsletterSendSummary);
}

async function createNewsletterSend(
  db: D1Database,
  input: {
    sendId: string;
    newsletterId: string;
    subject: string;
    sourceMessageId: string | null;
    recipientCount: number;
    contentFileName: string;
    textFileName: string | null;
    fromName: string | null;
    fanoutSnapshotAt: string;
    now: string;
  },
): Promise<NewsletterSendSummary> {
  await db
    .prepare(
      `INSERT INTO NewsletterSend (
         id, newsletter_id, subject, source_message_id, status,
         recipient_count, queued_count, fanout_queued_count, sending_count, retrying_count,
         queue_failed_count, provider_accepted_count,
         delivered_count, delivery_delayed_count, bounced_count, complained_count,
         failed_count, dead_lettered_count, needs_review_count,
         content_file_name, text_file_name, from_name, fanout_snapshot_at,
         fanout_cursor_email, fanout_completed_at, createdAt, updatedAt
       )
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    )
    .bind(
      input.sendId,
      input.newsletterId,
      input.subject,
      input.sourceMessageId,
      "queued",
      input.recipientCount,
      input.contentFileName,
      input.textFileName,
      input.fromName,
      input.fanoutSnapshotAt,
      input.now,
      input.now,
    )
    .run();
  const send = await getNewsletterSendSummary(db, input.sendId);
  if (!send) {
    throw new Error("Failed to create newsletter send record");
  }
  return send;
}

async function recordNewsletterSendEvent(
  db: D1Database,
  input: {
    sendId: string;
    newsletterId: string;
    recipient?: NewsletterSendRecipient | null;
    eventType: string;
    recipientStatus?: NewsletterSendRecipientStatus | null;
    sendStatus?: NewsletterSendStatus | null;
    message?: string | null;
    providerMessageId?: string | null;
    providerPayload?: string | null;
    now: string;
  },
): Promise<NewsletterSendEvent> {
  const result = await db
    .prepare(
      `INSERT INTO NewsletterSendEvent (
         send_id, newsletter_id, recipient_id, recipient_hash, email,
         event_type, recipient_status, send_status, message,
         provider_message_id, provider_payload, createdAt
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.sendId,
      input.newsletterId,
      input.recipient?.id ?? null,
      input.recipient?.recipientHash ?? null,
      input.recipient?.email ?? null,
      input.eventType,
      input.recipientStatus ?? null,
      input.sendStatus ?? null,
      input.message ?? null,
      input.providerMessageId ?? null,
      input.providerPayload?.slice(0, MAX_SUPPRESSION_PAYLOAD_LENGTH) ?? null,
      input.now,
    )
    .run();
  const row = await db
    .prepare(
      `SELECT id,
              send_id AS sendId,
              newsletter_id AS newsletterId,
              recipient_id AS recipientId,
              recipient_hash AS recipientHash,
              email,
              event_type AS eventType,
              recipient_status AS recipientStatus,
              send_status AS sendStatus,
              message,
              provider_message_id AS providerMessageId,
              createdAt
       FROM NewsletterSendEvent
       WHERE id = ?`,
    )
    .bind(result.meta.last_row_id)
    .first<Record<string, unknown>>();
  if (!row) {
    throw new Error("Failed to read newsletter send event record");
  }
  return mapNewsletterSendEvent(row);
}

function completedAtValue(
  status: NewsletterSendStatus,
  existingCompletedAt: string | null,
  now: string,
): string | null {
  if (status === "completed" || status === "completedWithFailures") {
    return existingCompletedAt ?? now;
  }
  return null;
}

type NewsletterSendCounterName =
  | "queuedCount"
  | "sendingCount"
  | "retryingCount"
  | "queueFailedCount"
  | "providerAcceptedCount"
  | "deliveredCount"
  | "deliveryDelayedCount"
  | "bouncedCount"
  | "complainedCount"
  | "failedCount"
  | "deadLetteredCount"
  | "needsReviewCount";

type NewsletterSendCounterDelta = Partial<Record<NewsletterSendCounterName, number>>;

function counterNameForRecipientStatus(
  status: NewsletterSendRecipientStatus,
  failureType: string | null = null,
): NewsletterSendCounterName | null {
  switch (status) {
    case "queued":
      return "queuedCount";
    case "sending":
      return "sendingCount";
    case "retrying":
      return "retryingCount";
    case "providerAccepted":
      return "providerAcceptedCount";
    case "deliveryDelayed":
      return "deliveryDelayedCount";
    case "delivered":
      return "deliveredCount";
    case "bounced":
      return "bouncedCount";
    case "complained":
      return "complainedCount";
    case "failed":
      return failureType === "queue" ? "queueFailedCount" : "failedCount";
    case "deadLettered":
      return "deadLetteredCount";
    case "needsReview":
      return "needsReviewCount";
  }
}

function buildRecipientStatusDelta(
  previousStatus: NewsletterSendRecipientStatus,
  nextStatus: NewsletterSendRecipientStatus,
  previousFailureType: string | null,
  nextFailureType: string | null,
): NewsletterSendCounterDelta {
  const delta: NewsletterSendCounterDelta = {};
  const previousCounter = counterNameForRecipientStatus(previousStatus, previousFailureType);
  const nextCounter = counterNameForRecipientStatus(nextStatus, nextFailureType);
  if (previousCounter) {
    delta[previousCounter] = (delta[previousCounter] ?? 0) - 1;
  }
  if (nextCounter) {
    delta[nextCounter] = (delta[nextCounter] ?? 0) + 1;
  }
  return delta;
}

function activeNewsletterSendCount(send: NewsletterSendSummary): number {
  return send.queuedCount + send.sendingCount + send.retryingCount
    + send.providerAcceptedCount + send.deliveryDelayedCount;
}

function deriveNewsletterSendStatus(send: NewsletterSendSummary): NewsletterSendStatus {
  if (!send.fanoutCompletedAt) {
    return activeNewsletterSendCount(send) > 0 ? "sending" : "queued";
  }
  if (activeNewsletterSendCount(send) > 0) {
    return "sending";
  }
  return newsletterSendFailureCount(send) > 0 ? "completedWithFailures" : "completed";
}

function newsletterSendFailureCount(send: NewsletterSendSummary): number {
  return send.queueFailedCount + send.bouncedCount + send.complainedCount
    + send.failedCount + send.deadLetteredCount + send.needsReviewCount;
}

async function updateNewsletterSendStatusFromCounters(
  db: D1Database,
  sendId: string,
  now: string,
): Promise<NewsletterSendSummary> {
  const current = await getNewsletterSendSummary(db, sendId);
  if (!current) {
    throw new Error("Newsletter send not found");
  }
  const status = deriveNewsletterSendStatus(current);
  const completedAt = completedAtValue(status, current.completedAt, now);
  await db
    .prepare(
      `UPDATE NewsletterSend
       SET status = ?,
           completedAt = ?,
           updatedAt = ?
       WHERE id = ?`,
    )
    .bind(status, completedAt, now, sendId)
    .run();
  const updated = await getNewsletterSendSummary(db, sendId);
  if (!updated) {
    throw new Error("Newsletter send not found after status update");
  }
  return updated;
}

async function applyNewsletterSendCounterDelta(
  db: D1Database,
  sendId: string,
  now: string,
  delta: NewsletterSendCounterDelta,
  lastError: string | null = null,
): Promise<NewsletterSendSummary> {
  await db
    .prepare(
      `UPDATE NewsletterSend
       SET queued_count = MAX(queued_count + ?, 0),
           sending_count = MAX(sending_count + ?, 0),
           retrying_count = MAX(retrying_count + ?, 0),
           queue_failed_count = MAX(queue_failed_count + ?, 0),
           provider_accepted_count = MAX(provider_accepted_count + ?, 0),
           delivered_count = MAX(delivered_count + ?, 0),
           delivery_delayed_count = MAX(delivery_delayed_count + ?, 0),
           bounced_count = MAX(bounced_count + ?, 0),
           complained_count = MAX(complained_count + ?, 0),
           failed_count = MAX(failed_count + ?, 0),
           dead_lettered_count = MAX(dead_lettered_count + ?, 0),
           needs_review_count = MAX(needs_review_count + ?, 0),
           last_error = COALESCE(?, last_error),
           updatedAt = ?
       WHERE id = ?`,
    )
    .bind(
      delta.queuedCount ?? 0,
      delta.sendingCount ?? 0,
      delta.retryingCount ?? 0,
      delta.queueFailedCount ?? 0,
      delta.providerAcceptedCount ?? 0,
      delta.deliveredCount ?? 0,
      delta.deliveryDelayedCount ?? 0,
      delta.bouncedCount ?? 0,
      delta.complainedCount ?? 0,
      delta.failedCount ?? 0,
      delta.deadLetteredCount ?? 0,
      delta.needsReviewCount ?? 0,
      lastError,
      now,
      sendId,
    )
    .run();
  return updateNewsletterSendStatusFromCounters(db, sendId, now);
}

function timestampColumnForStatus(
  status: NewsletterSendRecipientStatus,
): string | null {
  switch (status) {
    case "sending":
      return "sendingAt";
    case "providerAccepted":
      return "providerAcceptedAt";
    case "deliveryDelayed":
      return "deliveryDelayedAt";
    case "delivered":
      return "deliveredAt";
    case "bounced":
      return "bouncedAt";
    case "complained":
      return "complainedAt";
    case "failed":
      return "failedAt";
    case "deadLettered":
      return "deadLetteredAt";
    case "needsReview":
      return "needsReviewAt";
    case "queued":
      return "queuedAt";
    case "retrying":
      return null;
  }
}

function terminalRecipientStatusRank(
  status: NewsletterSendRecipientStatus,
): number | null {
  switch (status) {
    case "delivered":
      return 10;
    case "failed":
      return 20;
    case "bounced":
      return 30;
    case "complained":
      return 40;
    case "deadLettered":
      return 50;
    case "queued":
    case "sending":
    case "providerAccepted":
    case "deliveryDelayed":
    case "retrying":
    case "needsReview":
      return null;
  }
}

function shouldApplyRecipientStatusTransition(
  currentStatus: NewsletterSendRecipientStatus,
  nextStatus: NewsletterSendRecipientStatus,
): boolean {
  const currentRank = terminalRecipientStatusRank(currentStatus);
  const nextRank = terminalRecipientStatusRank(nextStatus);
  if (nextRank === null) {
    return currentRank === null;
  }
  if (currentRank === null) {
    return true;
  }
  return nextRank >= currentRank;
}

async function updateNewsletterSendRecipientStatus(
  env: Bindings,
  input: {
    sendId: string;
    newsletterId: string;
    recipientHash: string;
    status: NewsletterSendRecipientStatus;
    eventType: string;
    message?: string | null;
    providerMessageId?: string | null;
    providerPayload?: string | null;
    failureType?: string | null;
  },
): Promise<{
  send: NewsletterSendSummary;
  recipient: NewsletterSendRecipient;
  event: NewsletterSendEvent;
} | null> {
  const existing = await getNewsletterSendRecipientByHash(
    env.DB,
    input.sendId,
    input.recipientHash,
  );
  if (!existing || existing.newsletterId !== input.newsletterId) {
    return null;
  }

  const now = new Date().toISOString();
  if (!shouldApplyRecipientStatusTransition(existing.status, input.status)) {
    const send = await getNewsletterSendSummary(env.DB, input.sendId);
    if (!send) {
      return null;
    }
    const event = await recordNewsletterSendEvent(env.DB, {
      sendId: input.sendId,
      newsletterId: input.newsletterId,
      recipient: existing,
      eventType: input.eventType,
      recipientStatus: existing.status,
      sendStatus: send.status,
      message: input.message ?? null,
      providerMessageId: input.providerMessageId ?? existing.providerMessageId,
      providerPayload: input.providerPayload ?? null,
      now,
    });
    await broadcastNewsletterSendMessage(env, input.sendId, {
      type: "sendEvent",
      event,
      send,
      recipient: existing,
    });
    return { send, recipient: existing, event };
  }

  const timestampColumn = timestampColumnForStatus(input.status);
  const timestampAssignment = timestampColumn ? `${timestampColumn} = ?,` : "";
  const timestampValues = timestampColumn ? [now] : [];
  const attempts =
    input.status === "sending" ? existing.attempts + 1 : existing.attempts;
  const nextFailureType = input.failureType ?? null;
  const lastError =
    input.status === "retrying" ||
    input.status === "failed" ||
    input.status === "deadLettered" ||
    input.status === "needsReview"
      ? input.message ?? existing.lastError
      : null;

  await env.DB.prepare(
    `UPDATE NewsletterSendRecipient
     SET status = ?,
         attempts = ?,
         provider_message_id = ?,
         last_error = ?,
         failure_type = ?,
         ${timestampAssignment}
         updatedAt = ?
     WHERE send_id = ? AND recipient_hash = ?`,
  )
    .bind(
      input.status,
      attempts,
      input.providerMessageId ?? existing.providerMessageId,
      lastError,
      nextFailureType,
      ...timestampValues,
      now,
      input.sendId,
      input.recipientHash,
    )
    .run();

  const recipient = await getNewsletterSendRecipientByHash(
    env.DB,
    input.sendId,
    input.recipientHash,
  );
  if (!recipient) {
    return null;
  }
  const send = await applyNewsletterSendCounterDelta(
    env.DB,
    input.sendId,
    now,
    buildRecipientStatusDelta(
      existing.status,
      input.status,
      existing.failureType,
      nextFailureType,
    ),
    lastError,
  );
  const event = await recordNewsletterSendEvent(env.DB, {
    sendId: input.sendId,
    newsletterId: input.newsletterId,
    recipient,
    eventType: input.eventType,
    recipientStatus: input.status,
    sendStatus: send.status,
    message: input.message ?? null,
    providerMessageId: input.providerMessageId ?? recipient.providerMessageId,
    providerPayload: input.providerPayload ?? null,
    now,
  });
  await broadcastNewsletterSendMessage(env, input.sendId, {
    type: "sendEvent",
    event,
    send,
    recipient,
  });
  return { send, recipient, event };
}

async function beginNewsletterSendRecipientAttempt(
  env: Bindings,
  input: {
    sendId: string;
    newsletterId: string;
    recipientHash: string;
  },
): Promise<{
  send: NewsletterSendSummary;
  recipient: NewsletterSendRecipient;
  event: NewsletterSendEvent;
} | null> {
  const now = new Date().toISOString();
  const existing = await getNewsletterSendRecipientByHash(
    env.DB,
    input.sendId,
    input.recipientHash,
  );
  if (
    !existing ||
    existing.newsletterId !== input.newsletterId ||
    !["queued", "retrying"].includes(existing.status)
  ) {
    return null;
  }

  const result = await env.DB.prepare(
    `UPDATE NewsletterSendRecipient
     SET status = ?,
         attempts = attempts + 1,
         last_error = NULL,
         failure_type = NULL,
         sendingAt = ?,
         updatedAt = ?
     WHERE send_id = ?
       AND recipient_hash = ?
       AND newsletter_id = ?
       AND status = ?`,
  )
    .bind(
      "sending",
      now,
      now,
      input.sendId,
      input.recipientHash,
      input.newsletterId,
      existing.status,
    )
    .run();

  if (Number(result.meta.changes ?? 0) === 0) {
    return null;
  }

  const recipient = await getNewsletterSendRecipientByHash(
    env.DB,
    input.sendId,
    input.recipientHash,
  );
  if (!recipient) {
    return null;
  }

  const send = await applyNewsletterSendCounterDelta(
    env.DB,
    input.sendId,
    now,
    buildRecipientStatusDelta(existing.status, "sending", existing.failureType, null),
  );
  const event = await recordNewsletterSendEvent(env.DB, {
    sendId: input.sendId,
    newsletterId: input.newsletterId,
    recipient,
    eventType: "sending",
    recipientStatus: "sending",
    sendStatus: send.status,
    message: "Sending recipient email.",
    now,
  });
  await broadcastNewsletterSendMessage(env, input.sendId, {
    type: "sendEvent",
    event,
    send,
    recipient,
  });
  return { send, recipient, event };
}

async function broadcastNewsletterSendMessage(
  env: Bindings,
  sendId: string,
  message: NewsletterSendStreamMessage,
): Promise<void> {
  if (!env.SEND_STATUS_BROKER) {
    return;
  }
  try {
    const stub = env.SEND_STATUS_BROKER.getByName(sendId);
    const response = await stub.fetch(
      new Request("https://send-status-broker/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      }),
    );
    if (!response.ok) {
      throw new Error(
        `Send status broadcast failed with status ${response.status}`,
      );
    }
  } catch (error: unknown) {
    logError("broadcast-newsletter-send-status", error);
  }
}

function buildFanoutQueueMessage(
  input: {
    newsletterId: string;
    subject: string;
    fileName: string;
    textFileName?: string;
    fromName?: string | null;
    sendId: string;
    sourceMessageId: string;
    cursorEmail?: string | null;
    chunkIndex: number;
  },
): NewsletterFanoutQueueMessage {
  return {
    kind: "fanout",
    newsletterId: input.newsletterId,
    subject: input.subject,
    fileName: input.fileName,
    textFileName: input.textFileName,
    fromName: input.fromName ?? null,
    sendId: input.sendId,
    sourceMessageId: input.sourceMessageId,
    cursorEmail: input.cursorEmail ?? null,
    chunkIndex: input.chunkIndex,
  };
}

async function enqueueNewsletterFanoutForSend(
  env: Bindings,
  send: NewsletterSendSummary,
): Promise<boolean> {
  if (send.fanoutCompletedAt || !send.contentFileName || !send.sourceMessageId) {
    return false;
  }
  await env.QUEUE.send(buildFanoutQueueMessage({
    newsletterId: send.newsletterId,
    subject: send.subject,
    fileName: send.contentFileName,
    textFileName: send.textFileName ?? undefined,
    fromName: send.fromName,
    sendId: send.id,
    sourceMessageId: send.sourceMessageId,
    cursorEmail: send.fanoutCursorEmail,
    chunkIndex: Math.floor(send.fanoutQueuedCount / NEWSLETTER_FANOUT_PAGE_SIZE),
  }));
  return true;
}

async function advanceNewsletterSendFanout(
  db: D1Database,
  input: {
    sendId: string;
    expectedCursorEmail: string | null;
    nextCursorEmail: string | null;
    queuedCount: number;
    completed: boolean;
    now: string;
  },
): Promise<{ send: NewsletterSendSummary; advanced: boolean }> {
  const completionValue = input.completed ? input.now : null;
  const statement = input.expectedCursorEmail
    ? db.prepare(
        `UPDATE NewsletterSend
         SET queued_count = queued_count + ?,
             fanout_queued_count = fanout_queued_count + ?,
             fanout_cursor_email = ?,
             fanout_completed_at = COALESCE(?, fanout_completed_at),
             updatedAt = ?
         WHERE id = ? AND fanout_completed_at IS NULL AND fanout_cursor_email = ?`,
      ).bind(
        input.queuedCount,
        input.queuedCount,
        input.nextCursorEmail,
        completionValue,
        input.now,
        input.sendId,
        input.expectedCursorEmail,
      )
    : db.prepare(
        `UPDATE NewsletterSend
         SET queued_count = queued_count + ?,
             fanout_queued_count = fanout_queued_count + ?,
             fanout_cursor_email = ?,
             fanout_completed_at = COALESCE(?, fanout_completed_at),
             updatedAt = ?
         WHERE id = ? AND fanout_completed_at IS NULL AND fanout_cursor_email IS NULL`,
      ).bind(
        input.queuedCount,
        input.queuedCount,
        input.nextCursorEmail,
        completionValue,
        input.now,
        input.sendId,
      );

  const result = await statement.run();
  const send = await updateNewsletterSendStatusFromCounters(
    db,
    input.sendId,
    input.now,
  );
  return { send, advanced: Number(result.meta.changes ?? 0) > 0 };
}

async function processNewsletterFanoutMessage(
  env: Bindings,
  message: NewsletterFanoutQueueMessage,
): Promise<void> {
  const send = await getNewsletterSendSummary(env.DB, message.sendId);
  if (!send || send.newsletterId !== message.newsletterId) {
    return;
  }
  if (send.fanoutCompletedAt && send.queuedCount === 0) {
    return;
  }
  if (!send.fanoutSnapshotAt) {
    throw new Error(`Newsletter send ${send.id} is missing fanout snapshot metadata`);
  }

  const cursorEmail = normalizeNonEmptyString(message.cursorEmail);
  const subscribers = await getSubscribedSubscriberPage(
    message.newsletterId,
    env.DB,
    cursorEmail,
    NEWSLETTER_FANOUT_PAGE_SIZE,
    send.fanoutSnapshotAt,
  );
  const now = new Date().toISOString();
  if (subscribers.length === 0) {
    const { send: updatedSend, advanced } = await advanceNewsletterSendFanout(
      env.DB,
      {
        sendId: message.sendId,
        expectedCursorEmail: send.fanoutCursorEmail,
        nextCursorEmail: send.fanoutCursorEmail,
        queuedCount: 0,
        completed: true,
        now,
      },
    );
    if (advanced) {
      const event = await recordNewsletterSendEvent(env.DB, {
        sendId: message.sendId,
        newsletterId: message.newsletterId,
        eventType: "fanoutCompleted",
        sendStatus: updatedSend.status,
        message: "Subscriber fanout completed.",
        now,
      });
      await broadcastNewsletterSendMessage(env, message.sendId, {
        type: "sendEvent",
        event,
        send: updatedSend,
      });
    }
    return;
  }

  const recipients = await Promise.all(subscribers.map(async (subscriber) => ({
    id: crypto.randomUUID(),
    email: subscriber.email,
    recipientHash: await sha256Hex(`${message.sendId}:${subscriber.email}`),
  })));

  await env.DB.batch(recipients.map((recipient) => (
    env.DB.prepare(
      `INSERT OR IGNORE INTO NewsletterSendRecipient (
         id, send_id, newsletter_id, email, recipient_hash, status, attempts,
         queuedAt, updatedAt
       )
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).bind(
      recipient.id,
      message.sendId,
      message.newsletterId,
      recipient.email,
      recipient.recipientHash,
      "queued",
      now,
      now,
    )
  )));

  const recipientEntries = recipients.map((recipient) => ({
    email: recipient.email,
    recipientHash: recipient.recipientHash,
  }));
  const nextCursorEmail = subscribers[subscribers.length - 1].email;
  const completed = subscribers.length < NEWSLETTER_FANOUT_PAGE_SIZE;
  const { send: updatedSend, advanced } = await advanceNewsletterSendFanout(
    env.DB,
    {
      sendId: message.sendId,
      expectedCursorEmail: send.fanoutCursorEmail,
      nextCursorEmail,
      queuedCount: subscribers.length,
      completed,
      now,
    },
  );

  await env.QUEUE.sendBatch(
    chunkRecipientEntries(recipientEntries).map((recipientBatch) => ({
      body: buildRecipientBatchQueueMessage({
        newsletterId: message.newsletterId,
        subject: message.subject,
        fileName: message.fileName,
        textFileName: message.textFileName,
        fromName: message.fromName,
        sendId: message.sendId,
        recipients: recipientBatch,
      }),
    })),
  );

  if (!advanced) {
    return;
  }

  const event = await recordNewsletterSendEvent(env.DB, {
    sendId: message.sendId,
    newsletterId: message.newsletterId,
    eventType: completed ? "fanoutCompleted" : "fanoutChunkQueued",
    sendStatus: updatedSend.status,
    message: completed
      ? `Queued final fanout chunk with ${subscribers.length} recipient(s).`
      : `Queued fanout chunk with ${subscribers.length} recipient(s).`,
    now,
  });
  await broadcastNewsletterSendMessage(env, message.sendId, {
    type: "sendEvent",
    event,
    send: updatedSend,
  });

  if (!completed) {
    await env.QUEUE.send(buildFanoutQueueMessage({
      newsletterId: message.newsletterId,
      subject: message.subject,
      fileName: message.fileName,
      textFileName: message.textFileName,
      fromName: message.fromName,
      sendId: message.sendId,
      sourceMessageId: message.sourceMessageId,
      cursorEmail: nextCursorEmail,
      chunkIndex: message.chunkIndex + 1,
    }));
  }
}

async function markFanoutDeadLettered(
  env: Bindings,
  message: NewsletterFanoutQueueMessage,
): Promise<void> {
  const send = await getNewsletterSendSummary(env.DB, message.sendId);
  if (!send || send.newsletterId !== message.newsletterId || send.fanoutCompletedAt) {
    return;
  }
  const now = new Date().toISOString();
  const remaining = Math.max(0, send.recipientCount - send.fanoutQueuedCount);
  await env.DB.prepare(
    `UPDATE NewsletterSend
     SET queue_failed_count = queue_failed_count + ?,
         fanout_completed_at = ?,
         last_error = ?,
         updatedAt = ?
     WHERE id = ?`,
  )
    .bind(
      remaining,
      now,
      "Cloudflare Queue moved subscriber fanout to the dead-letter queue.",
      now,
      message.sendId,
    )
    .run();
  const updatedSend = await updateNewsletterSendStatusFromCounters(env.DB, message.sendId, now);
  const event = await recordNewsletterSendEvent(env.DB, {
    sendId: message.sendId,
    newsletterId: message.newsletterId,
    eventType: "fanoutDeadLettered",
    sendStatus: updatedSend.status,
    message: "Cloudflare Queue moved subscriber fanout to the dead-letter queue.",
    now,
  });
  await broadcastNewsletterSendMessage(env, message.sendId, {
    type: "sendEvent",
    event,
    send: updatedSend,
  });
}

async function publishNewsletter(
  env: Bindings,
  input: PublishNewsletterInput,
): Promise<PublishNewsletterEmailResult> {
  const sourceMessageId = normalizeNonEmptyString(input.sourceMessageId);
  if (!sourceMessageId) {
    return { ok: false, status: 400, error: "sourceMessageId is required" };
  }

  const existingSend = await getNewsletterSendSummaryBySourceMessage(
    env.DB,
    input.newsletterId,
    sourceMessageId,
  );
  if (existingSend) {
    await enqueueNewsletterFanoutForSend(env, existingSend);
    return {
      ok: true,
      newsletterId: input.newsletterId,
      subject: existingSend.subject,
      sendId: existingSend.id,
      send: existingSend,
      recipientCount: existingSend.recipientCount,
      queuedCount: 0,
      queueFailedCount: 0,
      duplicate: true,
    };
  }

  if (typeof input.subject !== "string") {
    return { ok: false, status: 400, error: "Subject is required" };
  }
  const subject = input.subject.trim();
  if (!input.allowEmptySubject && subject.length === 0) {
    return { ok: false, status: 400, error: "Subject is required" };
  }

  const html = typeof input.html === "string" ? input.html : "";
  const text = typeof input.text === "string" ? input.text : "";
  const hasContent = input.allowBlankContent
    ? html.length > 0 && text.length > 0
    : html.trim().length > 0 && text.trim().length > 0;
  if (!hasContent) {
    return {
      ok: false,
      status: 400,
      error: "Email html and text are required",
    };
  }

  const timestamp = Date.now();
  const now = new Date().toISOString();
  const sendId = crypto.randomUUID();
  const fileName = `newsletters/${input.newsletterId}/${timestamp}.html`;
  const textFileName = `newsletters/${input.newsletterId}/${timestamp}.txt`;

  await env.R2.put(fileName, html);
  await env.R2.put(textFileName, text);

  const recipientCount = await countSubscribedSubscribers(input.newsletterId, env.DB, now);
  const publishConfig = await getPublishConfig(env);
  let send: NewsletterSendSummary;
  try {
    send = await createNewsletterSend(env.DB, {
      sendId,
      newsletterId: input.newsletterId,
      subject,
      sourceMessageId,
      recipientCount,
      contentFileName: fileName,
      textFileName,
      fromName: publishConfig.fromName,
      fanoutSnapshotAt: now,
      now,
    });
  } catch (error: unknown) {
    const duplicateSend = await getNewsletterSendSummaryBySourceMessage(
      env.DB,
      input.newsletterId,
      sourceMessageId,
    );
    if (duplicateSend) {
      await enqueueNewsletterFanoutForSend(env, duplicateSend);
      return {
        ok: true,
        newsletterId: input.newsletterId,
        subject: duplicateSend.subject,
        sendId: duplicateSend.id,
        send: duplicateSend,
        recipientCount: duplicateSend.recipientCount,
        queuedCount: 0,
        queueFailedCount: 0,
        duplicate: true,
      };
    }
    throw error;
  }
  await recordNewsletterSendEvent(env.DB, {
    sendId,
    newsletterId: input.newsletterId,
    eventType: "sendCreated",
    sendStatus: send.status,
    message: `Created send for ${recipientCount} subscriber(s).`,
    now,
  });
  await enqueueNewsletterFanoutForSend(env, send);

  return {
    ok: true,
    newsletterId: input.newsletterId,
    subject,
    fileName,
    textFileName,
    sendId,
    send,
    recipientCount,
    queuedCount: 0,
    queueFailedCount: 0,
    duplicate: false,
  };
}

async function publishNewsletterEmail(
  env: Bindings,
  input: PublishNewsletterEmailInput,
): Promise<PublishNewsletterEmailResult> {
  const sender = extractEmailAddress(input.from);
  if (!sender || !getAllowedSenderEmails(env).includes(sender)) {
    return { ok: false, status: 403, error: "Sender not allowed" };
  }

  const rawSubject = normalizeNonEmptyString(input.subject);
  if (!rawSubject) {
    return { ok: false, status: 400, error: "Subject is required" };
  }

  const parsedSubject = parseNewsletterEmailSubject(rawSubject);
  if (!parsedSubject) {
    return {
      ok: false,
      status: 400,
      error: "No Newsletter ID found in subject",
    };
  }

  return publishNewsletter(env, {
    newsletterId: parsedSubject.newsletterId,
    subject: parsedSubject.subject,
    html: input.html,
    text: input.text,
    sourceMessageId: input.sourceMessageId,
    allowEmptySubject: true,
    allowBlankContent: input.allowBlankContent,
  });
}

type NewsletterRecipientDeliveryInput = {
  email: string;
  newsletterId: string;
  subject: string;
  fileName: string;
  textFileName?: string;
  fromName?: string | null;
  sendId?: string;
  recipientHash?: string;
  content?: NewsletterDeliveryContent;
};

type NewsletterRecipientBatchMetadata = {
  newsletterId: string;
  subject: string;
  fileName: string;
  textFileName?: string;
  fromName?: string | null;
  sendId: string;
};

type NewsletterDeliveryContent = {
  html: string;
  text: string;
};

async function readNewsletterDeliveryContent(
  env: Bindings,
  fileName: string,
  textFileName?: string,
): Promise<NewsletterDeliveryContent> {
  const [object, textObject] = await Promise.all([
    env.R2.get(fileName),
    textFileName ? env.R2.get(textFileName) : Promise.resolve(null),
  ]);
  if (!object) {
    throw new Error("Failed to get HTML content from R2");
  }

  const [html, text] = await Promise.all([
    object.text(),
    textObject ? textObject.text() : Promise.resolve(""),
  ]);
  return { html, text };
}

function chunkRecipientEntries(
  recipients: NewsletterRecipientQueueEntry[],
): NewsletterRecipientQueueEntry[][] {
  const batches: NewsletterRecipientQueueEntry[][] = [];
  for (let index = 0; index < recipients.length; index += NEWSLETTER_RECIPIENT_BATCH_SIZE) {
    batches.push(recipients.slice(index, index + NEWSLETTER_RECIPIENT_BATCH_SIZE));
  }
  return batches;
}

function buildRecipientBatchQueueMessage(
  input: NewsletterRecipientBatchMetadata & {
    recipients: NewsletterRecipientQueueEntry[];
  },
): NewsletterRecipientBatchQueueMessage {
  return {
    kind: "recipientBatch",
    newsletterId: input.newsletterId,
    subject: input.subject,
    fileName: input.fileName,
    textFileName: input.textFileName,
    fromName: input.fromName,
    sendId: input.sendId,
    recipients: input.recipients,
  };
}

async function enqueueNewsletterRecipientBatch(
  env: Bindings,
  input: NewsletterRecipientBatchMetadata & {
    recipients: NewsletterRecipientQueueEntry[];
    delaySeconds?: number;
  },
): Promise<void> {
  if (input.recipients.length === 0) {
    return;
  }

  await env.QUEUE.send(
    buildRecipientBatchQueueMessage(input),
    input.delaySeconds ? { delaySeconds: input.delaySeconds } : undefined,
  );
}

async function enqueueRecipientBatchFollowUps(
  env: Bindings,
  metadata: NewsletterRecipientBatchMetadata,
  retryRecipient: NewsletterRecipientQueueEntry,
  remainingRecipients: NewsletterRecipientQueueEntry[],
  delaySeconds: number,
): Promise<void> {
  await enqueueNewsletterRecipientBatch(env, {
    ...metadata,
    recipients: [retryRecipient],
    delaySeconds,
  });
  await enqueueNewsletterRecipientBatch(env, {
    ...metadata,
    recipients: remainingRecipients,
    delaySeconds,
  });
}

async function markNewsletterRecipientDeadLettered(
  env: Bindings,
  input: {
    sendId?: string;
    newsletterId: string;
    recipientHash?: string;
    includeQueued?: boolean;
  },
): Promise<void> {
  if (!input.sendId || !input.recipientHash) {
    return;
  }

  const recipient = await getNewsletterSendRecipientByHash(
    env.DB,
    input.sendId,
    input.recipientHash,
  );
  if (
    !recipient ||
    recipient.newsletterId !== input.newsletterId ||
    !(
      recipient.status === "sending" ||
      recipient.status === "retrying" ||
      (input.includeQueued !== false && recipient.status === "queued")
    )
  ) {
    return;
  }

  await updateNewsletterSendRecipientStatus(env, {
    sendId: input.sendId,
    newsletterId: input.newsletterId,
    recipientHash: input.recipientHash,
    status: "deadLettered",
    eventType: "deadLettered",
    message: "Cloudflare Queue moved this recipient to the dead-letter queue.",
    failureType: "deadLettered",
  });
}

async function handleRecipientBatchDeadLetter(
  env: Bindings,
  metadata: NewsletterRecipientBatchMetadata,
  recipients: NewsletterRecipientQueueEntry[],
): Promise<void> {
  const queuedRecipients: NewsletterRecipientQueueEntry[] = [];
  for (const recipient of recipients) {
    const existing = await getNewsletterSendRecipientByHash(
      env.DB,
      metadata.sendId,
      recipient.recipientHash,
    );
    if (!existing || existing.newsletterId !== metadata.newsletterId) {
      continue;
    }
    if (existing.status === "queued") {
      queuedRecipients.push(recipient);
      continue;
    }
    await markNewsletterRecipientDeadLettered(env, {
      sendId: metadata.sendId,
      newsletterId: metadata.newsletterId,
      recipientHash: recipient.recipientHash,
      includeQueued: false,
    });
  }

  await enqueueNewsletterRecipientBatch(env, {
    ...metadata,
    recipients: queuedRecipients,
    delaySeconds: NEWSLETTER_QUEUE_RETRY_DELAY_SECONDS,
  });
}

async function processNewsletterRecipientDelivery(
  env: Bindings,
  input: NewsletterRecipientDeliveryInput,
): Promise<{ retry: boolean; retryDelaySeconds: number }> {
  const {
    email,
    subject,
    newsletterId,
    fileName,
    textFileName,
    fromName,
    sendId,
    recipientHash: trackedRecipientHash,
    content,
  } = input;

  console.log(`Sending email to ${email} for newsletter ${newsletterId}`);

  try {
    if (sendId && trackedRecipientHash) {
      const started = await beginNewsletterSendRecipientAttempt(env, {
        sendId,
        newsletterId,
        recipientHash: trackedRecipientHash,
      });
      if (!started) {
        console.log(
          `Skipping duplicate queue delivery for ${email} on send ${sendId}`,
        );
        return { retry: false, retryDelaySeconds: NEWSLETTER_QUEUE_RETRY_DELAY_SECONDS };
      }
    }

    const deliveryContent =
      content ?? (await readNewsletterDeliveryContent(env, fileName, textFileName));
    const unsubscribeToken = await createUnsubscribeToken(
      env,
      email,
      newsletterId,
    );
    const origin = getPublicOrigin(env);
    const oneClickUrl = `${origin}/api/subscribe/list-unsubscribe/${unsubscribeToken}`;
    const visibleUnsubscribeUrl = `${origin}/api/subscribe/unsubscribe/${unsubscribeToken}`;
    const recipientHash =
      trackedRecipientHash ?? (await sha256Hex(`${newsletterId}:${email}`));
    const deliverableHtml = appendUnsubscribeFooterToHtml(
      deliveryContent.html,
      visibleUnsubscribeUrl,
    );
    const deliverableText = appendUnsubscribeFooterToText(
      deliveryContent.text,
      visibleUnsubscribeUrl,
    );

    const messageId = await sendEmail(
      env,
      email,
      subject,
      deliverableText,
      deliverableHtml,
      {
        fromName,
        headers: buildNewsletterListHeaders(
          newsletterId,
          recipientHash,
          oneClickUrl,
          sendId,
        ),
        tags: buildNewsletterEmailTags(newsletterId, recipientHash, sendId),
        idempotencyKey: sendId
          ? `newsletter:${sendId}:${recipientHash}`
          : null,
      },
    );
    if (sendId && trackedRecipientHash) {
      try {
        await updateNewsletterSendRecipientStatus(env, {
          sendId,
          newsletterId,
          recipientHash: trackedRecipientHash,
          status: "providerAccepted",
          eventType: "providerAccepted",
          message: "SES accepted the email for delivery.",
          providerMessageId: messageId ?? null,
        });
      } catch (trackingError: unknown) {
        logError("track-provider-accepted", trackingError);
        try {
          await updateNewsletterSendRecipientStatus(env, {
            sendId,
            newsletterId,
            recipientHash: trackedRecipientHash,
            status: "needsReview",
            eventType: "needsReview",
            message:
              "SES accepted the email, but recording provider acceptance failed. "
              + errorMessage(trackingError, "Provider acceptance tracking failed."),
            providerMessageId: messageId ?? null,
            failureType: "needsReview",
          });
        } catch (reviewError: unknown) {
          logError("track-needs-review-after-provider-accepted", reviewError);
        }
      }
    }
    console.log(
      `Email sent to ${email}${messageId ? ` with SES message ${messageId}` : ""}`,
    );
  } catch (error: unknown) {
    console.error(`Failed to send email to ${email}:`, error);
    const shouldRetry = shouldRetryRecipientError(error);
    const retryDelaySeconds = retryDelaySecondsForRecipientError(error);
    if (sendId && trackedRecipientHash) {
      try {
        await updateNewsletterSendRecipientStatus(env, {
          sendId,
          newsletterId,
          recipientHash: trackedRecipientHash,
          status: shouldRetry ? "retrying" : "needsReview",
          eventType: shouldRetry ? "retrying" : "needsReview",
          message: errorMessage(error, "Recipient send failed."),
          failureType: shouldRetry ? null : "needsReview",
        });
      } catch (trackingError: unknown) {
        logError(shouldRetry ? "track-retrying" : "track-needs-review", trackingError);
      }
    }
    return { retry: shouldRetry, retryDelaySeconds };
  }

  return { retry: false, retryDelaySeconds: NEWSLETTER_QUEUE_RETRY_DELAY_SECONDS };
}

export class SendStatusBroker {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Bindings,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/broadcast") {
      const message = (await request.json()) as NewsletterSendStreamMessage;
      for (const socket of this.state.getWebSockets()) {
        try {
          socket.send(JSON.stringify(message));
        } catch {
          socket.close(1011, "Failed to send status update");
        }
      }
      return Response.json({ message: "Broadcast sent" });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const sendId = url.searchParams.get("sendId") ?? "";
    const afterEventId = Math.max(
      0,
      Number(url.searchParams.get("afterEventId") ?? "0") || 0,
    );
    if (!isValidUuid(sendId)) {
      return new Response("Invalid sendId", { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    server.send(JSON.stringify({ type: "connected", sendId }));

    const events = await getNewsletterSendEvents(
      this.env.DB,
      sendId,
      afterEventId,
    );
    for (const event of events) {
      const send = await getNewsletterSendSummary(this.env.DB, event.sendId);
      const recipient = event.recipientHash
        ? await getNewsletterSendRecipientByHash(
            this.env.DB,
            event.sendId,
            event.recipientHash,
          )
        : null;
      server.send(JSON.stringify({
        type: "sendEvent",
        event,
        send: send ?? undefined,
        recipient: recipient ?? undefined,
      }));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string) {
    if (message === "ping") {
      socket.send("pong");
    }
  }
}

export default {
  fetch: app.fetch,
  async email(
    message: ForwardableEmailMessage,
    env: Bindings,
    ctx: ExecutionContext,
  ) {
    const subject = message.headers.get("subject") ?? "";

    console.log(`Processing email with subject: ${subject}`);

    const sender = extractEmailAddress(message.from);
    if (!sender || !getAllowedSenderEmails(env).includes(sender)) {
      message.setReject("Address not allowed");
      return;
    }

    if (!parseNewsletterEmailSubject(subject)) {
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
    const result = await publishNewsletterEmail(env, {
      from: message.from,
      subject,
      html: parsedEmail.html,
      text: parsedEmail.text,
      sourceMessageId: message.headers.get("message-id") ?? undefined,
      allowBlankContent: true,
    });

    if (!result.ok) {
      if (result.status === 403) {
        message.setReject("Address not allowed");
        return;
      }
      message.setReject(result.error);
      return;
    }
  },
  async queue(
    batch: MessageBatch<NewsletterQueueMessage>,
    env: Bindings,
  ): Promise<void> {
    const isDeadLetterBatch = batch.queue.endsWith("-dlq");
    for (const message of batch.messages) {
      if (isFanoutQueueMessage(message.body)) {
        if (isDeadLetterBatch) {
          await markFanoutDeadLettered(env, message.body);
          continue;
        }
        try {
          await processNewsletterFanoutMessage(env, message.body);
        } catch (error: unknown) {
          logError("newsletter-fanout", error);
          message.retry({ delaySeconds: NEWSLETTER_QUEUE_RETRY_DELAY_SECONDS });
        }
        continue;
      }

      if (isRecipientBatchQueueMessage(message.body)) {
        const {
          newsletterId,
          subject,
          fileName,
          textFileName,
          fromName,
          sendId,
          recipients,
        } = message.body;
        const metadata: NewsletterRecipientBatchMetadata = {
          newsletterId,
          subject,
          fileName,
          textFileName,
          fromName,
          sendId,
        };

        if (isDeadLetterBatch) {
          await handleRecipientBatchDeadLetter(env, metadata, recipients);
          continue;
        }

        let content: NewsletterDeliveryContent | undefined;
        try {
          content = await readNewsletterDeliveryContent(env, fileName, textFileName);
        } catch (error: unknown) {
          logError("newsletter-recipient-batch-content", error);
        }

        for (const [index, recipient] of recipients.entries()) {
          const result = await processNewsletterRecipientDelivery(env, {
            email: recipient.email,
            ...metadata,
            recipientHash: recipient.recipientHash,
            ...(content ? { content } : {}),
          });
          if (result.retry) {
            try {
              await enqueueRecipientBatchFollowUps(
                env,
                metadata,
                recipient,
                recipients.slice(index + 1),
                result.retryDelaySeconds,
              );
            } catch (error: unknown) {
              logError("newsletter-recipient-requeue", error);
              message.retry({ delaySeconds: result.retryDelaySeconds });
            }
            break;
          }
        }
        continue;
      }

      const { email, subject, newsletterId, fileName, textFileName, fromName, sendId } =
        message.body;
      const trackedRecipientHash = message.body.recipientHash;

      if (isDeadLetterBatch) {
        await markNewsletterRecipientDeadLettered(env, {
          sendId,
          newsletterId,
          recipientHash: trackedRecipientHash,
        });
        continue;
      }

      const result = await processNewsletterRecipientDelivery(env, {
        email,
        newsletterId,
        subject,
        fileName,
        textFileName,
        fromName,
        sendId,
        recipientHash: trackedRecipientHash,
      });
      if (result.retry) {
        message.retry({ delaySeconds: result.retryDelaySeconds });
      }
    }
  },
};
