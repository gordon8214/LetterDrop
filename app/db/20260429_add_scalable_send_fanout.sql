ALTER TABLE NewsletterSend ADD COLUMN sending_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE NewsletterSend ADD COLUMN retrying_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE NewsletterSend ADD COLUMN fanout_queued_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE NewsletterSend ADD COLUMN content_file_name TEXT;
ALTER TABLE NewsletterSend ADD COLUMN text_file_name TEXT;
ALTER TABLE NewsletterSend ADD COLUMN from_name TEXT;
ALTER TABLE NewsletterSend ADD COLUMN fanout_snapshot_at DATETIME;
ALTER TABLE NewsletterSend ADD COLUMN fanout_cursor_email TEXT;
ALTER TABLE NewsletterSend ADD COLUMN fanout_completed_at DATETIME;

ALTER TABLE Subscriber ADD COLUMN subscribed_at DATETIME;
ALTER TABLE Subscriber ADD COLUMN unsubscribed_at DATETIME;
ALTER TABLE Subscriber ADD COLUMN deleted_at DATETIME;

UPDATE Subscriber
SET subscribed_at = COALESCE(subscribed_at, upsertedAt, CURRENT_TIMESTAMP)
WHERE isSubscribed = 1;

UPDATE Subscriber
SET unsubscribed_at = COALESCE(unsubscribed_at, upsertedAt, CURRENT_TIMESTAMP)
WHERE isSubscribed = 0;

CREATE INDEX IF NOT EXISTS idx_subscriber_newsletter_subscribed_email
ON Subscriber(newsletter_id, isSubscribed, email);

CREATE INDEX IF NOT EXISTS idx_subscriber_newsletter_snapshot_email
ON Subscriber(newsletter_id, email, subscribed_at, unsubscribed_at, deleted_at);

CREATE INDEX IF NOT EXISTS idx_newsletter_send_recipient_status_email
ON NewsletterSendRecipient(send_id, status, email);

CREATE INDEX IF NOT EXISTS idx_newsletter_send_recipient_email
ON NewsletterSendRecipient(send_id, email);
