ALTER TABLE NewsletterSend ADD COLUMN scheduled_at DATETIME;

ALTER TABLE NewsletterDraft ADD COLUMN scheduled_at DATETIME;
ALTER TABLE NewsletterDraft ADD COLUMN schedule_next_attempt_at DATETIME;
ALTER TABLE NewsletterDraft ADD COLUMN schedule_claimed_at DATETIME;
ALTER TABLE NewsletterDraft ADD COLUMN schedule_last_attempt_at DATETIME;
ALTER TABLE NewsletterDraft ADD COLUMN schedule_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE NewsletterDraft ADD COLUMN schedule_last_error TEXT;
ALTER TABLE NewsletterDraft ADD COLUMN scheduled_content_file_name TEXT;
ALTER TABLE NewsletterDraft ADD COLUMN scheduled_text_file_name TEXT;
ALTER TABLE NewsletterDraft ADD COLUMN scheduled_from_name TEXT;
ALTER TABLE NewsletterDraft ADD COLUMN scheduled_footer_html TEXT;
ALTER TABLE NewsletterDraft ADD COLUMN scheduled_footer_text TEXT;
ALTER TABLE NewsletterDraft ADD COLUMN scheduled_email_style_config TEXT;

CREATE INDEX idx_newsletter_draft_due_schedule
ON NewsletterDraft(status, schedule_next_attempt_at, createdAt);

CREATE INDEX idx_newsletter_draft_scheduled_list
ON NewsletterDraft(newsletter_id, status, scheduled_at);
