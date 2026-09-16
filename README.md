# telebox

File hosting server. Upload files via web, stored in a Telegram private channel as blob storage. Next.js on Vercel as the app layer.

## Quick start

```bash
cp .env.example .env
# fill in TELEGRAM_BOT_TOKEN, TELEGRAM_STORAGE_CHAT_ID, SESSION_SECRET
npm run dev -- --webpack
```

Open http://localhost:3000

## Environment

| Variable | Required | Notes |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `TELEGRAM_STORAGE_CHAT_ID` | Yes | Private channel/supergroup chat ID |
| `SESSION_SECRET` | Yes | Random string for HMAC-signed session cookies |
| `UPSTASH_REDIS_REST_URL` | No | Rate limiting (falls back to in-memory locally) |
| `UPSTASH_REDIS_REST_TOKEN` | No | Rate limiting |
| `DB_PATH` | No | SQLite path local dev (default: `telebox.db`) |
| `DATABASE_URL` | Prod | Postgres connection string; when set, app uses Postgres instead of SQLite |

## Features

- Upload files up to 50MB (web or API)
- SHA-256 deduplication (same file = same ID)
- Image/video/audio preview at `/i/:id`
- Raw file serving at `/raw/:id` with long-lived cache headers
- Accounts, file ownership, soft delete
- API keys (`tb_` prefix) for CLI access
- Expiration TTL (1 hour to 30 days)
- Abuse reports on preview pages
- Magic-byte validation (extension spoof protection)
- Rate limiting on upload, auth, and report endpoints
- Admin dashboard at `/admin`

## API

All endpoints are JSON. Auth via session cookie or `Authorization: Bearer <api_key>`.

### Upload

```bash
# single file
curl -H 'Authorization: Bearer tb_...' -F 'file=@photo.jpg' http://localhost:3000/api/upload

# multi-file
curl -H 'Authorization: Bearer tb_...' -F 'file=@a.jpg' -F 'file=@b.pdf' http://localhost:3000/api/upload

# with expiration (TTL in seconds)
curl -H 'Authorization: Bearer tb_...' -F 'file=@doc.pdf' -F 'ttl=86400' http://localhost:3000/api/upload
```

## Testing

`npm test` runs the `node:test` suite (no framework needed): magic-byte validation, TTL parsing.

### List files

```bash
curl -H 'Authorization: Bearer tb_...' http://localhost:3000/api/files
```

### Delete file

```bash
curl -X DELETE -H 'Authorization: Bearer tb_...' http://localhost:3000/api/files/:id
```

### Create API key

```bash
curl -X POST -H 'Content-Type: application/json' -d '{"name":"cli"}' http://localhost:3000/api/keys
```

Key is shown once at creation. Revoke with `DELETE /api/keys`.

### Report abuse

```bash
curl -X POST -H 'Content-Type: application/json' -d '{"id":"FILE_ID","reason":"spam"}' http://localhost:3000/api/reports
```

## Pages

| Path | Description |
|---|---|
| `/` | Upload page (multi-file drag-drop) |
| `/i/:id` | File preview (image/video/audio/text) |
| `/raw/:id` | Raw file (download or inline) |
| `/my` | My Files + API Keys management |
| `/admin` | Admin dashboard (stats + reports) |

## Tech

- Next.js 16 (App Router), React 19
- `node:sqlite` for local dev (swap to Postgres/Neon for Vercel)
- `node:crypto` for SHA-256 + scrypt auth
- Telegram Bot API for blob storage
- Zero runtime dependencies beyond Next.js + React

## Deploy to Vercel

1. Set `DATABASE_URL` (Neon/Postgres) in Vercel env — the app auto-switches from SQLite to Postgres when set
2. Set environment variables in Vercel dashboard (incl. `UPSTASH_REDIS_REST_URL`/`TOKEN`)
3. Deploy

Rate limiter uses Upstash Redis when `UPSTASH_REDIS_REST_*` is set; falls back to in-memory locally.

Postgres path is covered by tests via PGlite (real Postgres in WASM) — run `npm test`.

node -e                                                               │
 │                          │ "console.log(require('crypto').randomBytes(32).toString('hex'))"