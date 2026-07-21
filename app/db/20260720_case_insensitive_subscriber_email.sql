CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriber_newsletter_email_nocase
ON Subscriber(newsletter_id, email COLLATE NOCASE);

-- Repair automatic suppressions that failed to match legacy mixed-case
-- subscriber rows. Suppressions older than a later subscription are ignored
-- so an intentional resubscription remains active.
WITH qualifying_suppressions AS (
  SELECT
    s.email AS subscriber_email,
    s.newsletter_id,
    MIN(e.createdAt) AS first_suppression_at,
    MAX(e.createdAt) AS latest_suppression_at
  FROM Subscriber s
  INNER JOIN SuppressionEvent e
    ON e.newsletter_id = s.newsletter_id
   AND e.email = s.email COLLATE NOCASE
  WHERE s.isSubscribed = 1
    AND s.deleted_at IS NULL
    AND e.event_type IN ('complaint', 'bounce:Permanent')
    AND julianday(e.createdAt) >= COALESCE(
      julianday(s.subscribed_at),
      julianday(s.upsertedAt),
      0
    )
  GROUP BY s.email, s.newsletter_id
)
UPDATE Subscriber
SET isSubscribed = 0,
    upsertedAt = (
      SELECT latest_suppression_at
      FROM qualifying_suppressions q
      WHERE q.subscriber_email = Subscriber.email
        AND q.newsletter_id = Subscriber.newsletter_id
    ),
    unsubscribed_at = (
      SELECT first_suppression_at
      FROM qualifying_suppressions q
      WHERE q.subscriber_email = Subscriber.email
        AND q.newsletter_id = Subscriber.newsletter_id
    )
WHERE EXISTS (
  SELECT 1
  FROM qualifying_suppressions q
  WHERE q.subscriber_email = Subscriber.email
    AND q.newsletter_id = Subscriber.newsletter_id
);
