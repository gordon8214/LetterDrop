-- schema.sql

CREATE TABLE Newsletter (
    id TEXT PRIMARY KEY,
    title TEXT,
    description TEXT,
    logo TEXT,
    subscribable BOOLEAN,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Subscriber (
    email TEXT,
    first_name TEXT,
    last_name TEXT,
    newsletter_id TEXT,
    isSubscribed BOOLEAN,
    upsertedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (email, newsletter_id),
    FOREIGN KEY (newsletter_id) REFERENCES Newsletter(id)
);

CREATE TABLE AbuseEvent (
    id TEXT PRIMARY KEY,
    bucket TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_abuse_event_lookup ON AbuseEvent(bucket, key_hash, createdAt);
