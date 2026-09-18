# PRD — TELEBOX

Serverless file hosting + pastebin. Telegram (private channel) as blob storage, metadata in a separate DB, Next.js on Vercel as the application layer.

## Current scope (v1 — shipped)

- Anonymous upload via web + `POST /api/upload` — public share links
- Account uploads — private to the owner, gated by session/API key
- Direct URL: `GET /raw/:id[/:name]` with HTTP Range support (206/416)
- Chunked upload protocol (init → 3 MiB parts → complete) for files up to **50 MB** on platforms with a ~4.5 MB request-body cap
- SHA-256 dedup, scoped per owner; server-side hash verification of stored bytes
- Random non-enumerable IDs (57-char alphabet, rejection sampling)
- Accounts, sessions (password-hash-bound, revocable), API keys
- Expiration TTL (1 h–30 d) with hourly cron janitor + self-heal sweeps
- Pastebin: create, feed, detail, comments (edit/delete own), like, star — per-person reactions
- Profile: display name, avatar (Telegram-stored), password change (revokes other sessions)
- Share links `/s/:token`: revocable, expiring capability tokens for private files
- Rate limiting (Upstash Redis or in-memory) on all mutation endpoints
- Security headers (CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy)

## Non-goals (v1)

Admin dashboard, abuse reports, URL import, image thumbnails/transcoding, multi-user orgs, end-to-end encryption, self-hosted Bot API support (documented as a manual scaling path instead).

## Phases

0. Scaffold + docs — done
1. Upload → Telegram → metadata → raw serve — done
2. `/i/:id` image page, download headers, multi-file — done
3. Accounts, sessions, ownership, delete — done
4. API keys, rate limiting, expiration, admin — done (admin intentionally dropped from scope)
5. Chunked >4 MB uploads, Range serving, session revocation, security headers — done

## Constraints

- Telegram Bot API cloud: 50 MB `sendDocument` cap, **20 MB `getFile` download cap** (hence the 20 MB direct-upload ceiling), per-chat rate limits, no CDN guarantees.
- Telegram `/file/bot...` URLs are not a stable CDN; proxy through the app or switch to a self-hosted Bot API server for larger files.
- Vercel request body limit (~4.5 MB) applies before the route handler sees the file — the chunked protocol exists because of this.
- `node:sqlite` writes to local disk. Vercel's FS is read-only except `/tmp` — swap to Postgres/Neon before deploying.

## Success criteria

- Uploads of 5–50 MB succeed from the browser on Vercel (chunked path) and are previewable/downloadable, including seekable video.
- No unhandled exception path returns an HTML 500; every client-visible error is structured JSON with a correct status.
- All verified by `npm test` (64 tests), `tsc --noEmit`, `eslint`, `next build`.
