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
