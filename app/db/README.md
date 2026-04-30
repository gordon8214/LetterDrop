# Database for the app

## Create the database

```bash
wrangler d1 execute <d1_database_name> --remote --file db/schema.sql
```

## Run name migration on existing database

```bash
wrangler d1 execute <d1_database_name> --remote --file db/20260222_add_subscriber_names.sql
```

## Run abuse-protection migration on existing database

```bash
wrangler d1 execute <d1_database_name> --remote --file db/20260223_add_abuse_event_table.sql
```

## Run send-tracking migration on existing database

```bash
wrangler d1 execute <d1_database_name> --remote --file db/20260428_add_newsletter_send_tracking.sql
```

## Run duplicate-safe send tracking migration on existing database

```bash
wrangler d1 execute <d1_database_name> --remote --file db/20260429_add_duplicate_safe_send_tracking.sql
```

## Run scalable send fanout migration on existing database

```bash
wrangler d1 execute <d1_database_name> --remote --file db/20260429_add_scalable_send_fanout.sql
```

## Run newsletter drafts migration on existing database

```bash
wrangler d1 execute <d1_database_name> --remote --file db/20260430_add_newsletter_drafts.sql
```
