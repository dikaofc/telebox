# telebox

File hosting server. Upload files via web, stored in a Telegram private channel as blob storage. Next.js on Vercel as the app layer.

Privacy model: uploads without an account are public share links; uploads from an account are private to that account — the owner's session/API key is required to view, preview, or download them (404 for anyone else). No admin role exists. Deleting a file also removes the blob from Telegram.

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
| `SESSION_SECRET` | Yes | Random string for HMAC-signed session cookies; app refuses to start in production without it |
| `UPSTASH_REDIS_REST_URL` | No | Rate limiting (falls back to in-memory locally) |
| `UPSTASH_REDIS_REST_TOKEN` | No | Rate limiting |
| `DB_PATH` | No | SQLite path local dev (default: `telebox.db`) |
| `DATABASE_URL` | Prod | Postgres connection string; when set, app uses Postgres instead of SQLite |

## Features

- Upload files up to 50MB (web or API), multi-file
- Account uploads private to owner; anonymous uploads are public links
- SHA-256 deduplication scoped per owner (a second user never receives another user's link)
- Image/video/audio/text preview at `/i/:id`
- Raw file serving at `/raw/:id[/filename]` with long-lived cache headers
- Accounts, ownership, delete (soft-deletes the row **and** removes the Telegram blob)
- API keys (`tb_` prefix) for CLI access
- Expiration TTL (1 hour to 30 days), lazy sweep on access
- Magic-byte validation (extension spoof protection)
- Rate limiting on upload, signup (5/60s), login (10/60s)
- Public pastebin: create pastes, comment, like, star — anyone can read and copy, reactions are per-person (account or IP-derived for anonymous)
- Profile page: display name, password change, profile photo (stored in Telegram, served at `/avatar/:id`)

## API

All endpoints are JSON. Auth via session cookie or `Authorization: Bearer <api_key>`.

### Upload

```bash
# single file (anonymous = public link)
curl -F 'file=@photo.jpg' http://localhost:3000/api/upload

# multi-file, authenticated (result files are private to the account)
curl -H 'Authorization: Bearer tb_...' -F 'file=@a.jpg' -F 'file=@b.pdf' http://localhost:3000/api/upload

# with expiration (TTL in seconds)
curl -H 'Authorization: Bearer tb_...' -F 'file=@doc.pdf' -F 'ttl=86400' http://localhost:3000/api/upload
```

### List files

```bash
curl -H 'Authorization: Bearer tb_...' http://localhost:3000/api/files
```

### File info / delete

```bash
# info — owner only (404 otherwise)
curl -H 'Authorization: Bearer tb_...' http://localhost:3000/api/files/:id

# delete — removes DB row and Telegram blob
curl -X DELETE -H 'Authorization: Bearer tb_...' http://localhost:3000/api/files/:id
```

### Create API key

```bash
curl -X POST -H 'Content-Type: application/json' -d '{"name":"cli"}' http://localhost:3000/api/keys
```

Key is shown once at creation. Revoke with `DELETE /api/keys`.

### Pastebin

```bash
# create (public)
curl -X POST -H 'Content-Type: application/json' -d '{"title":"t","content":"body","language":"python"}' http://localhost:3000/api/pastes

# feed
curl http://localhost:3000/api/pastes

# detail (content + counts + comments)
curl http://localhost:3000/api/pastes/:id

# toggle like / star (per person)
curl -X POST http://localhost:3000/api/pastes/:id/like
curl -X POST http://localhost:3000/api/pastes/:id/star

# comment
curl -X POST -H 'Content-Type: application/json' -d '{"body":"nice"}' http://localhost:3000/api/pastes/:id/comments
```

### Profile

```bash
curl http://localhost:3000/api/profile            # own profile (session)
curl -X PATCH -H 'Content-Type: application/json' -d '{"name":"New Name"}' http://localhost:3000/api/profile
curl -X POST -H 'Content-Type: application/json' -d '{"current_password":"old","new_password":"newpass123"}' http://localhost:3000/api/profile/password
curl -F 'avatar=@photo.png' http://localhost:3000/api/profile/avatar
```

## Pages

| Path | Description |
|---|---|
| `/` | Upload page (multi-file drag-drop, login/signup) |
| `/i/:id` | File preview (image/video/audio/text) — public for anonymous files, owner-only for account files |
| `/raw/:id` or `/raw/:id/:filename` | Raw file (download or inline) — same access model |
| `/my` | My Files + API Keys management |
| `/pastebin` | Public paste feed (copy, comment, like, star) |
| `/paste/new` | Create a paste |
| `/paste/:id` | Paste detail + comments |
| `/profile` | Profile settings (name, password, photo) |
| `/avatar/:id` | Public profile photo |

## Tech

- Next.js 16 (App Router), React 19
- SQLite (`node:sqlite`) local dev, Postgres (`pg`) when `DATABASE_URL` set — same SQL, dual-backend facade
- `node:crypto` for SHA-256 + scrypt auth
- Telegram Bot API for blob storage; `deleteMessage` purges on delete/expiry
- Upstash Redis REST for rate limiting (optional)
- Runtime deps: Next.js, React, `pg`

## Deploy to Vercel

1. Set `DATABASE_URL` (Neon/Postgres) — the app auto-switches from SQLite to Postgres when set (Vercel FS is read-only)
2. Set the other env vars: `SESSION_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_STORAGE_CHAT_ID`, and optionally Upstash
3. Deploy; Node version is pinned via `engines` in `package.json`

Rate limiter uses Upstash Redis when `UPSTASH_REDIS_REST_*` is set; falls back to in-memory locally.

Postgres path is covered by tests via PGlite (real Postgres in WASM) — run `npm test`.