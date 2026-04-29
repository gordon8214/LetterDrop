ALTER TABLE NewsletterSend ADD COLUMN needs_review_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE NewsletterSendRecipient ADD COLUMN needsReviewAt DATETIME;

-- The previous KV-backed idempotency was time-limited, so historical sends can
-- contain duplicate source_message_id values. Keep the earliest send as the
-- permanent idempotency target and clear later duplicates before indexing.
UPDATE NewsletterSend
SET source_message_id = NULL
WHERE source_message_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM NewsletterSend AS kept
    WHERE kept.newsletter_id = NewsletterSend.newsletter_id
      AND kept.source_message_id = NewsletterSend.source_message_id
      AND (
        COALESCE(kept.createdAt, '') < COALESCE(NewsletterSend.createdAt, '')
        OR (
          COALESCE(kept.createdAt, '') = COALESCE(NewsletterSend.createdAt, '')
          AND kept.id < NewsletterSend.id
        )
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_send_source_message
ON NewsletterSend(newsletter_id, source_message_id)
WHERE source_message_id IS NOT NULL;
