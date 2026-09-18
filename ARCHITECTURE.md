# Architecture

```
client
  |  multipart POST /api/upload           (single file ≤ 3 MiB)
  |     OR chunked protocol               (init → 3 MiB parts → complete)
  v
Next.js route (runtime: nodejs)
  |  size check, MIME sniff (extension + magic bytes), hash, owner-scoped dedup
  v
Telegram Bot API  -->  private storage channel
  |  returns chat_id / message_id / file_id
  v
metadata DB (id, name, mime, size, sha256, tg ids, expires_at, created_at, user_id)
  ^
  |  SELECT by id (owner-gated for account files)
GET /raw/:id  -->  Telegram getFile  -->  stream to client (Range-capable)
```

Layers:

- Application: Next.js app router. Holds bot token; never exposes it to the browser.
- Storage: Telegram private channel. Blob only.
- Metadata: DB keyed by `id`, indexed on `sha256`. Telegram is never queried for metadata.

## Privacy model

- Anonymous uploads (`user_id = 0`, seeded system user) are public share links — anyone with the URL can view/download.
- Account uploads are private to their owner. `/raw`, `/i`, and `GET /api/files/[id]` all check the session (or API key) against `files.user_id` and return 404 otherwise. Same response for missing file and wrong owner — no existence oracle.
- Dedup is scoped by `user_id`: a second account uploading identical bytes gets its own row, never the first account's link.
- There is no admin role and no global stats/report endpoints — nothing aggregates other users' data.
- Deleting a file (owner-only) soft-deletes the row and calls Telegram `deleteMessage`, so the blob leaves the channel too. Expiry sweep does the same.

## Data model

- `users(id, email UNIQUE, password_hash, name, avatar_file_id, avatar_mime, avatar_tg_chat_id, avatar_tg_message_id, created_at)` — session accounts.
- `api_keys(id, user_id, key_hash, name, created_at, last_used_at)` — bearer credentials, hashed at rest (SHA-256 of the plaintext; the key itself is shown once at creation).
- `files(id, name, mime, size, sha256, tg_chat_id, tg_message_id, tg_file_id, storage_kind, user_id, expires_at, created_at, deleted_at)` — blobs live in Telegram; this table is the only metadata source. `user_id = 0` = anonymous/public. `storage_kind` is `single` (one document) or `parts` (chunked, see below).
- `upload_sessions(id, user_id, name, mime, size, sha256, total_parts, expires_at, created_at)` — in-flight chunked uploads (staging). Janitored after 24 h.
- `file_parts(file_id, part_index, size, tg_chat_id, tg_message_id, tg_file_id)` — one Telegram document per 3 MiB part, PK `(file_id, part_index)`.
- `pastes(id, title, content, language, user_id, author_name, created_at)` — public pastebin.
- `paste_likes(paste_id, actor, created_at)`, `paste_stars(paste_id, actor, created_at)` — PK `(paste_id, actor)`, one reaction per person. `actor` is `user:<id>` for accounts or `ip:<sha256(ip+salt)[:16]>` for anonymous visitors, so anons can retract their own vote without impersonating another.
- `paste_comments(id, paste_id, user_id, author_name, body, created_at)` — authors can edit/delete their own comments.
- `shares(id, file_id, token UNIQUE, created_at, expires_at)` — capability tokens for private files. Serving via `/s/:token` bypasses the owner gate; the token is the authorization.

## Key decisions

- DB: dual-backend facade in `src/lib/db.ts`. SQLite (`node:sqlite`, lazy-required, sync wrapped async) when `DATABASE_URL` unset; Postgres (`pg` Pool, `?` → `$n` placeholders translated outside string literals, BIGINT timestamps coerced to numbers, `ON CONFLICT` seeds, FK enforcement) when set. SQL strings are shared across both — call sites stay identical. Postgres dialect verified by tests against PGlite (real Postgres compiled to WASM).
- IDs: 12 chars from a 57-char alphabet via `crypto.randomBytes` with rejection sampling (no modulo bias). ~70 bits, non-enumerable.
- Chunked upload (`src/lib/multipart.ts`, `src/app/api/upload/route.ts`): files > 3 MiB are split client-side into 3 MiB parts. Non-final parts must be exactly full (a short middle part is rejected so byte offsets can't shift). The client's SHA-256 claim is verified at `complete` by streaming every stored part back through a hasher (`hashStoredParts` in `src/lib/raw-serve.ts`) — mismatch drops all staging. `complete` is idempotent, including under a concurrent-call race on the `files` PK. Direct single-request uploads are capped at 20 MB because Telegram's `getFile` cannot download larger files (the chunked path's parts are all far below that).
- Dedup: SELECT on `sha256` + `user_id` + `deleted_at IS NULL` + `(expires_at IS NULL OR expires_at > now)` — owner-scoped so private links never cross accounts; expired/deleted files never trigger dedup.
- Streaming: response body piped from the Telegram fetch, no buffering on read. HTTP Range requests are honored end-to-end (`parseRange` + per-part slicing in `raw-serve.ts`): 206/416 semantics, video seek and resumable downloads work for both single-blob and parts files. Multi-range requests serve the first range only.
- MIME validation: extension whitelist + magic-byte sniff against the first 512 bytes (`matchesMagic` in `validation.ts`). Client `Content-Type` is never trusted. Text types (txt/csv/json/svg) skip binary checks — SVG is always served as attachment to neuter script-in-SVG.
- Auth: scrypt password hashing (`src/lib/auth.ts`) at OWASP-recommended parameters (N=2^17, r=8, p=1), stored versioned as `scrypt:v17:<salt>:<hash>`. Legacy rows (N=2^14, unprefixed) still verify and transparently rehash on successful login. Login timing is equalized between unknown-email and wrong-password via `referenceHash()`. HMAC-signed session cookie (`SESSION_SECRET`) via `session.ts`; API key bearer fallback via `resolveUserId` (key length sanity-checked before hashing). Secret is fail-closed in production — no predictable fallback.
- Session revocation: session tokens embed a 16-hex-char prefix of the account's current scrypt hash. Every request re-checks the prefix against the DB, so a password change (or a login-triggered legacy rehash) instantly invalidates all previously issued tokens — a stolen cookie can always be killed by rotating the password. The token contains no secret material.
- Rate limiting: Upstash Redis REST (atomic INCR+EXPIRE pipeline), 3s timeout, fail-open, in-memory fallback for local dev. Applied to: upload (120/min), signup (5/60s), login (10/60s), paste create (10/60s), comments (10/60s), likes/stars (60/min), avatar upload (10/60s), API-key creation (10/60s per account). Client IP comes from one shared helper (`clientIp` in `session.ts`).
- Expiration: upload accepts `ttl` (60s–30d, default none) → `expires_at`. Lazy sweep on access purges immediately, but a guaranteed janitor (`purgeExpired` in `src/lib/purge.ts`) makes expiry real for never-requested files: it deletes the Telegram blob + row for expired files, drops soft-deleted rows past a 7-day retention, and reclaims abandoned chunked-upload sessions (Telegram part messages + staging rows, including orphan parts). Runs hourly from `GET /api/cron/purge` (Vercel cron in `vercel.json`; optional `CRON_SECRET` compared timing-safely), probabilistically from ~1 in 20 uploads, and lazily on access. Bounded at 50 rows/pass.
- Pastebin: public read for everyone; create/comment/like/star are rate-limited per IP. Author name comes from the account profile or "anonymous". Comment edit/delete is owner-checked server-side. Avatars go through the standard file validation (MIME + magic bytes) plus an image-only allowlist, stored in Telegram as a regular blob; the `/avatar/:id` route clamps the served mime to the allowlist.
- Share links: `/s/:token` for private files. A 192-bit random token (`sh_` prefix) is the capability — no lookup by id, no enumeration, no existence leak (missing token/share/file/owner all read 404). Share expiry uses the same TTL clamp as uploads (60s–30d). `files` DELETE and the expiry sweep cascade-delete shares.
- User columns (`name`, `avatar_file_id`, `avatar_mime`, …) are added by idempotent migrations on both backends — SQLite tolerates duplicate-column errors, Postgres uses `ADD COLUMN IF NOT EXISTS`.
- Telegram `getFile` URLs expire and are IP-locked to the bot; never cached client-side beyond the proxied response. Every Telegram RPC has a fetch timeout so a hung call can't pin a serverless invocation.
- Error handling: no route lets an unexpected throw escape as an HTML 500. JSON bodies that fail to parse, unknown actions, form-data races, and Telegram failures all answer structured JSON with an appropriate status. The cosmetic filename segment of `/raw/:id/:name` decodes defensively (malformed percent-encoding can't 500).
- Security headers (`next.config.ts`): CSP (`default-src 'self'`, no external script/style origins), `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` locking camera/mic/geo. React's auto-escaping plus CSP gives two independent layers against XSS from pastes/comments/filenames.
- In-memory rate limiter fallback keeps dev working with zero setup; swap to Upstash happens automatically when `UPSTASH_REDIS_REST_URL`/`TOKEN` are set.

## Frontend notes

- `theme-toggle.tsx` reads the stored theme through `useSyncExternalStore` with a neutral server snapshot — no hydration mismatch, no flash of wrong theme, and no setState-in-effect.
- Components use theme CSS variables everywhere (no hardcoded colors), so dark mode is consistent.
- The chunked uploader retries each part up to 3 times with backoff and retries `complete` on 502/503 only (deterministic 4xx fail fast). Progress UI shows per-part progress.
- The markdown/highlight tokenizer (`highlight.ts`) is dependency-free; its compiled-pattern cache is bounded (LRU-style, 64 entries) because the language key comes from user input.

## Testing

`npm test` runs `node --test` over `tests/`:

- `multipart.test.ts` — part math (totalPartsFor, expectedPartSize), session staleness, init metadata validation, MIME/extension checks
- `purge.test.ts` — janitor passes against a real SQLite DB (expired rows, retention, stale sessions, idempotency)
- `pg.test.ts` — PGlite-backed schema, seed, placeholder translation, dedup query shapes, BIGINT coercion
- `validation.test.ts` — magic bytes and spoof rejection
- `paste.test.ts` — paste/comment validation, language normalization
- `share.test.ts` — share TTL clamping, token entropy/format
- `ttl.test.ts`, `highlight.test.ts` — TTL clamps; tokenizer correctness (including text reconstruction)

Verification performed: `tsc --noEmit` clean, `eslint` clean, all 64 tests pass, `next build` succeeds.

## Deploy notes

- Vercel FS is read-only; with `DATABASE_URL` set, telebox uses Postgres/Neon, so no disk writes. Leave `DATABASE_URL` unset only for local dev.
- Vercel request body limit applies before the route handler sees the file — this is exactly why the chunked protocol exists (see README).
- Bot API cloud caps `sendDocument` at 50MB and `getFile` download at 20MB. For single blobs > 20MB or files > 50MB overall, run a self-hosted Bot API server and raise the constants in `src/lib/multipart.ts`.
- Set `SESSION_SECRET`, `DATABASE_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_STORAGE_CHAT_ID` (and optionally `CRON_SECRET`) as Vercel env vars.
