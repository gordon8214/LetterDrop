DROP INDEX IF EXISTS idx_newsletter_draft_due_schedule;

CREATE INDEX idx_newsletter_draft_due_schedule
ON NewsletterDraft(status, schedule_next_attempt_at, createdAt);
