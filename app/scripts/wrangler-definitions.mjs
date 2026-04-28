// Shared binding definitions used by both the local deploy guard
// and the CI template validator. Keep this in sync with wrangler.example.toml.

export const requiredBindings = [
  { key: 'binding = "DB"', label: 'D1 database (DB)' },
  { key: 'binding = "KV"', label: 'KV namespace (KV)' },
  { key: 'binding = "R2"', label: 'R2 bucket (R2)' },
  { key: 'binding = "QUEUE"', label: 'Queue producer (QUEUE)' },
  { key: 'binding = "NOTIFICATION"', label: 'Service binding (NOTIFICATION)' },
  { key: 'ALLOWED_EMAILS', label: 'Var: ALLOWED_EMAILS' },
  { key: 'PUBLISH_EMAIL_ADDRESS', label: 'Var: PUBLISH_EMAIL_ADDRESS' },
  { key: 'TURNSTILE_SITE_KEY', label: 'Var: TURNSTILE_SITE_KEY' },
  { key: '[[queues.consumers]]', label: 'Queue consumer' },
  { key: 'dead_letter_queue', label: 'Dead letter queue' },
]

export const forbiddenPatterns = [
  'replace-with-',
  'REPLACE_WITH_',
  'example.com',
  '00000000000000000000000000000000',
  '00000000-0000-0000-0000-000000000000',
]

// Patterns that indicate real (non-placeholder) resource IDs.
// Used by the template validator to catch accidental commits of real values.
export const realValuePatterns = [
  /id = "(?!0{32})[0-9a-f]{32}"/,                                          // real KV namespace IDs (not all zeros)
  /database_id = "(?!0{8}-0{4}-0{4}-0{4}-0{12})[0-9a-f]{8}-[0-9a-f]{4}-/, // real D1 UUIDs (not all zeros)
]
