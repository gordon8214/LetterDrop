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
    subscribed_at DATETIME,
    unsubscribed_at DATETIME,
    deleted_at DATETIME,
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

CREATE TABLE SuppressionEvent (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    newsletter_id TEXT,
    event_type TEXT NOT NULL,
    provider_message_id TEXT,
    provider_payload TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_suppression_event_lookup ON SuppressionEvent(email, newsletter_id, createdAt);

CREATE TABLE NewsletterSend (
    id TEXT PRIMARY KEY,
    newsletter_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    source_message_id TEXT,
    status TEXT NOT NULL,
    recipient_count INTEGER NOT NULL DEFAULT 0,
    queued_count INTEGER NOT NULL DEFAULT 0,
    fanout_queued_count INTEGER NOT NULL DEFAULT 0,
    sending_count INTEGER NOT NULL DEFAULT 0,
    retrying_count INTEGER NOT NULL DEFAULT 0,
    queue_failed_count INTEGER NOT NULL DEFAULT 0,
    provider_accepted_count INTEGER NOT NULL DEFAULT 0,
    delivered_count INTEGER NOT NULL DEFAULT 0,
    delivery_delayed_count INTEGER NOT NULL DEFAULT 0,
    bounced_count INTEGER NOT NULL DEFAULT 0,
    complained_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    dead_lettered_count INTEGER NOT NULL DEFAULT 0,
    needs_review_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    content_file_name TEXT,
    text_file_name TEXT,
    from_name TEXT,
    fanout_snapshot_at DATETIME,
    fanout_cursor_email TEXT,
    fanout_completed_at DATETIME,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    completedAt DATETIME,
    FOREIGN KEY (newsletter_id) REFERENCES Newsletter(id)
);

CREATE INDEX idx_newsletter_send_lookup ON NewsletterSend(newsletter_id, createdAt);
CREATE UNIQUE INDEX idx_newsletter_send_source_message
ON NewsletterSend(newsletter_id, source_message_id)
WHERE source_message_id IS NOT NULL;
CREATE INDEX idx_subscriber_newsletter_subscribed_email
ON Subscriber(newsletter_id, isSubscribed, email);
CREATE INDEX idx_subscriber_newsletter_snapshot_email
ON Subscriber(newsletter_id, email, subscribed_at, unsubscribed_at, deleted_at);

CREATE TABLE NewsletterSendRecipient (
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
    needsReviewAt DATETIME,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (send_id) REFERENCES NewsletterSend(id),
    FOREIGN KEY (newsletter_id) REFERENCES Newsletter(id),
    UNIQUE(send_id, email),
    UNIQUE(send_id, recipient_hash)
);

CREATE INDEX idx_newsletter_send_recipient_provider ON NewsletterSendRecipient(provider_message_id);
CREATE INDEX idx_newsletter_send_recipient_status_email
ON NewsletterSendRecipient(send_id, status, email);
CREATE INDEX idx_newsletter_send_recipient_email
ON NewsletterSendRecipient(send_id, email);

CREATE TABLE NewsletterSendEvent (
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

CREATE INDEX idx_newsletter_send_event_stream ON NewsletterSendEvent(send_id, id);

CREATE TABLE NewsletterDraft (
    id TEXT PRIMARY KEY,
    newsletter_id TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    source_message_id TEXT NOT NULL,
    content_file_name TEXT NOT NULL,
    text_file_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    send_id TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    sentAt DATETIME,
    FOREIGN KEY (newsletter_id) REFERENCES Newsletter(id),
    FOREIGN KEY (send_id) REFERENCES NewsletterSend(id)
);

CREATE INDEX idx_newsletter_draft_active
ON NewsletterDraft(newsletter_id, status, updatedAt);

CREATE UNIQUE INDEX idx_newsletter_draft_source_message
ON NewsletterDraft(newsletter_id, source_message_id);
