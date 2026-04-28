# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

All commands run from the `app/` directory (use `npm --prefix app run <script>` from repo root):

```bash
npm --prefix app install              # Install dependencies
npm --prefix app run dev              # Local dev server (wrangler dev)
npm --prefix app run build            # Type-check only (tsc --noEmit)
npm --prefix app run test             # Run tests once (vitest run)
npm --prefix app run test:watch       # Watch mode tests
npm --prefix app run deploy:safe      # Full deploy: check bindings + smoke test + deploy
```

## Architecture

LetterDrop is a serverless newsletter service running on **Cloudflare Workers** using the **Hono** framework (TypeScript). The entire application logic lives in a single file: `app/src/index.ts`.

### Cloudflare Bindings

The Worker uses five Cloudflare bindings, all defined in `wrangler.toml`:

| Binding | Type | Purpose |
|---------|------|---------|
| DB | D1 (SQLite) | Newsletters, subscribers, abuse events |
| KV | KV Namespace | One-time subscription/unsubscription tokens (with TTL) |
| R2 | R2 Bucket | Newsletter HTML content storage |
| QUEUE | Queue | Async email delivery fan-out |
| NOTIFICATION | Service Binding | External email-sending worker (AWS SES) |

### Request Flows

- **Admin API** (`/api/newsletter*`): Bearer token auth (`ADMIN_API_TOKEN` secret) + Cloudflare Access headers. Fail-closed design.
- **Public subscription** (`/newsletter/:id`): Turnstile CAPTCHA + 3-tier rate limiting (pre-Turnstile IP throttle, post-Turnstile IP throttle, per-target throttle). Tokens stored in KV with TTL.
- **Email ingest**: Cloudflare Email Worker receives mail, or the Google Workspace bridge posts parsed Gmail messages to `/api/publish/google-workspace`; both paths store HTML in R2, fan out via Queue, and deliver via the NOTIFICATION service binding.
- **Queue consumer**: Reads HTML from R2 -> sends to each subscriber via NOTIFICATION.

### Database Migrations

Schema files live in `app/db/`. Migrations are applied manually via wrangler CLI:
```bash
wrangler d1 execute <db_name> --remote --file db/<migration>.sql
```

### Configuration

- `app/wrangler.toml` is **gitignored** (contains real resource IDs). Copy from `app/wrangler.example.toml`.
- Secrets (`ADMIN_API_TOKEN`, `PUBLISH_BRIDGE_TOKEN`, `TURNSTILE_SECRET_KEY`) are set via `wrangler secret put`.
- Variables (`ALLOWED_EMAILS`, `PUBLISH_EMAIL_ADDRESS`, `TURNSTILE_SITE_KEY`) are set in `wrangler.toml` `[vars]`.

### Security Model

- Admin routes: Cloudflare Access (edge) + Bearer token (worker-level, timing-safe comparison)
- Public routes: Turnstile bot verification + multi-layer rate limiting with `AbuseEvent` table
- Rate limiting fails open during migration (AbuseEvent table missing)
- HTML responses include XSS-safe escaping; i18n supports English and Chinese via `Accept-Language`

### Testing

Tests are in `app/test/index.test.ts` using Vitest. They use in-memory fakes for D1, KV, R2, and Fetcher — no real Cloudflare services needed.

### CI

`.github/workflows/validate-wrangler.yml` validates that `wrangler.example.toml` contains all required bindings on PRs and pushes to main.
