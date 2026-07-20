ALTER TABLE Newsletter ADD COLUMN deletedAt DATETIME;
ALTER TABLE NewsletterDraft ADD COLUMN deletedAt DATETIME;

CREATE INDEX idx_newsletter_deleted_at ON Newsletter(deletedAt);
CREATE INDEX idx_newsletter_draft_deleted_at
ON NewsletterDraft(newsletter_id, deletedAt, updatedAt);
CREATE INDEX idx_subscriber_deleted_at
ON Subscriber(newsletter_id, deleted_at, upsertedAt);

DROP INDEX idx_newsletter_draft_source_message;
CREATE UNIQUE INDEX idx_newsletter_draft_source_message
ON NewsletterDraft(newsletter_id, source_message_id)
WHERE deletedAt IS NULL;
