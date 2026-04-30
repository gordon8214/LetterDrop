CREATE TABLE IF NOT EXISTS NewsletterDraft (
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

CREATE INDEX IF NOT EXISTS idx_newsletter_draft_active
ON NewsletterDraft(newsletter_id, status, updatedAt);

CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_draft_source_message
ON NewsletterDraft(newsletter_id, source_message_id);
