CREATE TABLE IF NOT EXISTS AbuseEvent (
    id TEXT PRIMARY KEY,
    bucket TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_abuse_event_lookup ON AbuseEvent(bucket, key_hash, createdAt);
