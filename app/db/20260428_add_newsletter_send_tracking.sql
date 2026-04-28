CREATE TABLE IF NOT EXISTS NewsletterSend (
    id TEXT PRIMARY KEY,
    newsletter_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    source_message_id TEXT,
    status TEXT NOT NULL,
    recipient_count INTEGER NOT NULL DEFAULT 0,
    queued_count INTEGER NOT NULL DEFAULT 0,
    queue_failed_count INTEGER NOT NULL DEFAULT 0,
    provider_accepted_count INTEGER NOT NULL DEFAULT 0,
    delivered_count INTEGER NOT NULL DEFAULT 0,
    delivery_delayed_count INTEGER NOT NULL DEFAULT 0,
    bounced_count INTEGER NOT NULL DEFAULT 0,
    complained_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    dead_lettered_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    completedAt DATETIME,
    FOREIGN KEY (newsletter_id) REFERENCES Newsletter(id)
);

CREATE INDEX IF NOT EXISTS idx_newsletter_send_lookup ON NewsletterSend(newsletter_id, createdAt);

CREATE TABLE IF NOT EXISTS NewsletterSendRecipient (
    id TEXT PRIMARY KEY,
    send_id TEXT NOT NULL,
    newsletter_id TEXT NOT NULL,
    email TEXT NOT NULL,
    recipient_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    failure_type TEXT,
    provider_message_id TEXT,
    last_error TEXT,
    queuedAt DATETIME,
    sendingAt DATETIME,
    providerAcceptedAt DATETIME,
    deliveryDelayedAt DATETIME,
    deliveredAt DATETIME,
    bouncedAt DATETIME,
    complainedAt DATETIME,
    failedAt DATETIME,
    deadLetteredAt DATETIME,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (send_id) REFERENCES NewsletterSend(id),
    FOREIGN KEY (newsletter_id) REFERENCES Newsletter(id),
    UNIQUE(send_id, email),
    UNIQUE(send_id, recipient_hash)
);

CREATE INDEX IF NOT EXISTS idx_newsletter_send_recipient_provider ON NewsletterSendRecipient(provider_message_id);

CREATE TABLE IF NOT EXISTS NewsletterSendEvent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    send_id TEXT NOT NULL,
    newsletter_id TEXT NOT NULL,
    recipient_id TEXT,
    recipient_hash TEXT,
    email TEXT,
    event_type TEXT NOT NULL,
    recipient_status TEXT,
    send_status TEXT,
    message TEXT,
    provider_message_id TEXT,
    provider_payload TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (send_id) REFERENCES NewsletterSend(id),
    FOREIGN KEY (newsletter_id) REFERENCES Newsletter(id),
    FOREIGN KEY (recipient_id) REFERENCES NewsletterSendRecipient(id)
);

CREATE INDEX IF NOT EXISTS idx_newsletter_send_event_stream ON NewsletterSendEvent(send_id, id);
