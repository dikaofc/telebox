# Architecture

```
client
  |  multipart POST /api/upload
  v
Next.js route (runtime: nodejs)
  |  size check, MIME sniff (extension + magic bytes), hash, owner-scoped dedup
  v
Telegram Bot API  -->  private storage channel
  |  returns chat_id / message_id / file_id
  v
metadata DB (id, name, mime, size, sha256, tg ids, expires_at, created_at, user_id, deleted_at)
  ^
  |  SELECT by id (owner-gated for account files)
GET /raw/:id  -->  Telegram getFile  -->  stream to client
```

Layers:

- Application: Next.js app router. Holds bot token; never exposes it to the browser.
- Storage: Telegram private channel. Blob only.
- Metadata: DB keyed by `id`, unique-ish on `sha256` (indexed). Telegram is never queried for metadata.

## Privacy model

- Anonymous uploads (`user_id = 0`, seeded system user) are public share links — anyone with the URL can view/download.
- Account uploads are private to their owner. `/raw`, `/i`, and `GET /api/files/[id]` all check the session (or API key) against `files.user_id` and return 404 otherwise. Same response for missing file and wrong owner — no existence oracle.
- Dedup is scoped by `user_id`: a second account uploading identical bytes gets its own row, never the first account's link.
- There is no admin role and no global stats/report endpoints — nothing aggregates other users' data.
- Deleting a file (owner-only) soft-deletes the row and calls Telegram `deleteMessage`, so the blob leaves the channel too. Expiry sweep does the same.

## Data model

- `users(id, email UNIQUE, password_hash, name, avatar_file_id, avatar_mime, created_at)` — session accounts.
- `api_keys(id, user_id, key_hash, name, created_at, last_used_at)` — bearer credentials, hashed at rest (`sha256` of the plaintext; the key itself is shown once at creation).
- `files(id, name, mime, size, sha256, tg_chat_id, tg_message_id, tg_file_id, user_id, expires_at, created_at, deleted_at)` — blobs live in Telegram; this table is the only metadata source. `user_id = 0` = anonymous/public.
- `pastes(id, title, content, language, user_id, author_name, created_at)` — public pastebin.
- `paste_likes(paste_id, actor, created_at)`, `paste_stars(paste_id, actor, created_at)` — PK `(paste_id, actor)`, one reaction per person. `actor` is `user:<id>` for accounts or `ip:<sha256(ip+salt)[:16]>` for anonymous visitors, so anons can retract their own vote without impersonating another.
- `paste_comments(id, paste_id, user_id, author_name, body, created_at)`.
- `shares(id, file_id, token UNIQUE, created_at, expires_at)` — capability tokens for private files. Serving via `/s/:token` bypasses the owner gate; the token is the authorization.

## Key decisions

- DB: dual-backend facade in `src/lib/db.ts`. SQLite (`node:sqlite`, lazy-required, sync wrapped async) when `DATABASE_URL` unset; Postgres (`pg` Pool, `?` → `$n` placeholders, BIGINT timestamps, `ON CONFLICT` seeds, FK enforcement) when set. SQL strings are shared across both — call sites stay identical. Postgres dialect verified by tests against PGlite (real Postgres compiled to WASM).
- IDs: 12 chars from a 57-char alphabet via `crypto.randomBytes`. ~70 bits.
- Dedup: SELECT on `sha256` + `user_id` + `deleted_at IS NULL` + `(expires_at IS NULL OR expires_at > now)` — owner-scoped so private links never cross accounts; expired/deleted files never trigger dedup.
- Streaming: response body piped from the Telegram fetch, no buffering on read.
- MIME validation: extension whitelist + magic-byte sniff against the first 512 bytes (`matchesMagic` in `validation.ts`). Client `Content-Type` is never trusted. Text types (txt/csv/json/svg) skip binary checks — SVG is always served as attachment to neuter script-in-SVG.
- Auth: HMAC-signed session cookie (`SESSION_SECRET`) via `session.ts`; API key bearer fallback via `resolveUserId`. Secret is fail-closed in production — no predictable fallback. scrypt password hashing.
- Rate limiting: Upstash Redis REST (atomic INCR+EXPIRE pipeline), 3s timeout, fail-open, in-memory fallback for local dev. Applied to upload, signup (5/60s), login (10/60s).
- Expiration: upload accepts `ttl` (60s–30d, default none) → `expires_at`. Lazy sweep on access marks expired rows `deleted_at` and purges the Telegram message (serverless-compatible; a real janitor replaces it later).
- Pastebin: public read for everyone; create/comment/like/star are rate-limited per IP. Author name comes from the account profile or "anonymous". Avatar uploads go through the standard file validation (MIME + magic bytes) plus an image-only allowlist, stored in Telegram as a regular blob.
- Share links: `/s/:token` for private files. A 192-bit random token (`sh_` prefix) is the capability — no lookup by id, no enumeration, no existence leak (missing token/share/file/owner all read 404). Share expiry uses the same TTL clamp as uploads (60s–30d). `files` DELETE and the expiry sweep cascade-delete shares.
- User columns (`name`, `avatar_file_id`, `avatar_mime`) are added by idempotent migrations on both backends — SQLite tolerates duplicate-column errors, Postgres uses `ADD COLUMN IF NOT EXISTS`.
- Telegram `getFile` URLs expire and are IP-locked to the bot; never cached client-side beyond the proxied response.
- In-memory rate limiter fallback keeps dev working with zero setup; swap to Upstash happens automatically when `UPSTASH_REDIS_REST_URL`/`TOKEN` are set.

## Deploy notes

- Vercel FS is read-only; with `DATABASE_URL` set, telebox uses Postgres/Neon, so no disk writes. Leave `DATABASE_URL` unset only for local dev.
- Vercel request body limit applies before the route handler sees the file.
- Bot API cloud caps `sendDocument` at 50MB. For larger, run a self-hosted Bot API server.
- Set `SESSION_SECRET`, `DATABASE_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_STORAGE_CHAT_ID` as Vercel env vars.