# Architecture

```
client
  |  multipart POST /api/upload
  v
Next.js route (runtime: nodejs)
  |  size check, MIME sniff (extension + magic bytes), hash, dedup lookup
  v
Telegram Bot API  -->  private storage channel
  |  returns chat_id / message_id / file_id
  v
metadata DB (id, name, mime, size, sha256, tg ids, expires_at, created_at, user_id, deleted_at)
  ^
  |  SELECT by id
GET /raw/:id  -->  Telegram getFile  -->  stream to client
```

Layers:

- Application: Next.js app router. Holds bot token; never exposes it to the browser.
- Storage: Telegram private channel. Blob only.
- Metadata: DB keyed by `id`, unique-ish on `sha256` (indexed). Telegram is never queried for metadata.

## Data model

- `users(id, name, email UNIQUE, password_hash, created_at)` — session accounts.
- `api_keys(id, user_id, key_hash, label, created_at, last_used_at)` — bearer credentials, hashed at rest (`sha256` of the plaintext; the key itself is shown once at creation).
- `files(id, name, mime, size, sha256, tg_chat_id, tg_message_id, tg_file_id, user_id, expires_at, created_at, deleted_at)` — blobs live in Telegram; this table is the only metadata source.
- `reports(id, file_id, reason, created_at, reviewed)` — abuse reports; resolution soft-deletes the file.

Anonymous uploads use `user_id = 0` (seeded system user; FK not enforced — `PRAGMA foreign_keys` not set in `db.ts`).

## Key decisions

- DB: dual-backend facade in `src/lib/db.ts`. SQLite (`node:sqlite`, sync wrapped async) when `DATABASE_URL` unset; Postgres (`pg` Pool, `?` → `$n` placeholders, BIGINT timestamps, `ON CONFLICT` seeds, FK enforcement) when set. SQL strings are shared across both — call sites stay identical. Postgres dialect verified by tests against PGlite (real Postgres compiled to WASM).
- IDs: 12 chars from a 57-char alphabet via `crypto.randomBytes`. ~70 bits.
- Dedup: SELECT on `sha256` + `deleted_at IS NULL` + `(expires_at IS NULL OR expires_at > now)` — expired or deleted files never trigger dedup, so a re-upload creates a fresh row.
- Streaming: response body piped from the Telegram fetch, no buffering on read.
- MIME validation: extension whitelist + magic-byte sniff against the first 512 bytes (`matchesMagic` in `validation.ts`). Client `Content-Type` is never trusted. Text types (txt/csv/json/svg) skip binary checks — SVG is always served as attachment to neuter script-in-SVG.
- Session auth: HMAC-signed cookie (`SESSION_SECRET`) via `session.ts`; API key bearer fallback via `resolveUserId`. API keys are hashed in the DB.
- Rate limiting: Upstash Redis REST (atomic INCR+EXPIRE pipeline), 3s timeout, fail-open, in-memory fallback for local dev. Applied to upload, report POST, signup (5/60s), login (10/60s).
- Expiration: upload accepts `ttl` (60s–30d, default none) → `expires_at`. Lazy sweep on access marks expired rows `deleted_at` (serverless-compatible; a real janitor replaces it later). Stale URL cleanup: `sweepExpired()` in db.
- Reports: anonymous POST (rate-limited), admin-only GET list + DELETE resolution (soft-delete file).
- Telegram `getFile` URLs expire and are IP-locked to the bot; never cached client-side beyond the proxied response.
- In-memory rate limiter fallback keeps dev working with zero setup; swap to Upstash happens automatically when `UPSTASH_REDIS_REST_URL`/`TOKEN` are set.

## Deploy notes

- Vercel FS is read-only; with `DATABASE_URL` set, telebox uses Postgres/Neon, so no disk writes. Leave `DATABASE_URL` unset only for local dev.
- Vercel request body limit applies before the route handler sees the file.
- Bot API cloud caps `sendDocument` at 50MB. For larger, run a self-hosted Bot API server.
- Set `SESSION_SECRET`, `DATABASE_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_STORAGE_CHAT_ID` as Vercel env vars.