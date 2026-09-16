# PRD — TELEBOX

Serverless file hosting. Telegram (private channel) as blob storage, metadata in a separate DB, Next.js on Vercel as the application layer.

## Scope (v0)

- Anonymous upload via web + `POST /api/upload`
- Direct URL: `GET /raw/:id`
- SHA-256 dedup (same bytes return the existing ID)
- Random non-enumerable IDs

## Non-goals (v0)

Accounts, API keys, admin dashboard, expiration, gallery, abuse reports, URL import.

## Phases

0. Scaffold + docs
1. Upload → Telegram → metadata → raw serve (this)
2. `/i/:id` image page, download headers, multi-file
3. Accounts, sessions, ownership, delete
4. API keys, rate limiting, expiration, admin

Full feature breakdown lived in the original design conversation; sections 4-65 apply to later phases.

## Constraints

- Telegram Bot API cloud: 50MB upload cap, per-chat rate limits, no CDN guarantees.
- Telegram `/file/bot...` URLs are not a stable CDN; proxy through the app or switch to a self-hosted Bot API server for large files.
- Vercel request body limit applies before the route handler sees the file.
- `node:sqlite` writes to local disk. Vercel's FS is read-only except `/tmp` — swap to Postgres/Neon before deploying.