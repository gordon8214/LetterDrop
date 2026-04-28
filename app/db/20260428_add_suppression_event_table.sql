CREATE TABLE IF NOT EXISTS SuppressionEvent (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    newsletter_id TEXT,
    event_type TEXT NOT NULL,
    provider_message_id TEXT,
    provider_payload TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_suppression_event_lookup ON SuppressionEvent(email, newsletter_id, createdAt);
