# i365-letter-drop

## How to run

```
npm install
wrangler secret put ADMIN_API_TOKEN
wrangler secret put TURNSTILE_SECRET_KEY
npm run dev
```

```
npm run deploy
```

Before running in production, copy `/app/wrangler.example.toml` to a local config if you need a sanitized template. Keep `/app/wrangler.toml` deploy-safe for the active environment.

Run deploy guard checks before production deploy:

```
npm run check:wrangler
npm run smoke:deploy -- --env production
npm run deploy:safe
```

## Architecture

### API Schema

[swagger](./api.swagger.yml)

### Database Schema

```mermaid
erDiagram
    Newsletter ||--o{ Subscriber : has

    Newsletter {
        string id PK
        string title
        string description 
        string logo
        bool subscribable
        datetime createdAt
        datetime updatedAt
    }

    Subscriber {
        string email PK
        string first_name
        string last_name
        string newsletter_id PK
        bool isSubscribed
        datetime upsertedAt
    }

    AbuseEvent {
        string id PK
        string bucket
        string key_hash
        datetime createdAt
    }
```
