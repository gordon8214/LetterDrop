CREATE TABLE TrashPurgeJob (
    kind TEXT NOT NULL CHECK (kind IN ('newsletter', 'draft')),
    newsletter_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    content_file_name TEXT,
    text_file_name TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (kind, newsletter_id, item_id)
);
