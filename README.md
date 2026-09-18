# telebox

File hosting + pastebin. Upload files via web or API, stored in a Telegram private channel as blob storage, metadata in SQLite (local) or Postgres (production). Next.js 16 (App Router) on Vercel as the application layer.

**File uploads up to 50 MB work on Vercel** — files above ~3 MB are automatically split into 3 MiB chunks by the browser client and reassembled server-side (see [Chunked upload protocol](#chunked-upload-protocol)).

## Privacy model

- Uploads without an account are **public share links** — anyone with the URL can view/download.
- Uploads from an account are **private to that account** — the owner's session or API key is required to view, preview, or download them. Everyone else gets a 404 (same response as a missing file, so there is no existence oracle).
- No admin role exists.
- Deleting a file soft-deletes the row **and** removes the blob from Telegram.
- Deduplication is scoped per owner: a second user uploading identical bytes never receives the first user's link.

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
| `SESSION_SECRET` | Yes | Random string for HMAC-signed session cookies; app refuses to start in production without it. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DB_PATH` | No | SQLite path local dev (default: `telebox.db`) |
| `DATABASE_URL` | Prod | Postgres connection string; when set, app uses Postgres instead of SQLite |
| `UPSTASH_REDIS_REST_URL` | No | Distributed rate limiting (falls back to in-memory locally) |
| `UPSTASH_REDIS_REST_TOKEN` | No | Upstash REST token |
| `CRON_SECRET` | No | Gates `/api/cron/purge` when set |

## Features

- Upload files up to **50 MB** — anything above 3 MB is chunked automatically by the browser, so the Vercel 4.5 MB request-body limit is never hit
- Account uploads private to owner; anonymous uploads are public links
- SHA-256 deduplication scoped per owner
- Image/video/audio/text preview at `/i/:id` — video seeking and resumable downloads work via HTTP Range (206 Partial Content)
- Raw file serving at `/raw/:id[/filename]` with long-lived cache headers
- Accounts, ownership, delete (soft-deletes the row **and** removes the Telegram blob)
- API keys (`tb_` prefix) for CLI access
- Expiration TTL (1 hour to 30 days), guaranteed by a janitor (hourly cron + self-heal on access)
- Magic-byte validation (extension spoof protection)
- Rate limiting on upload, signup, login, pastes, comments, likes/stars, avatar uploads, API-key creation
- Public pastebin: create pastes, comment, edit/delete own comments, like, star — reactions are per-person (account or IP-derived for anonymous)
- Profile page: display name, password change, profile photo (stored in Telegram, served at `/avatar/:id`)
- Share links for private files: `/s/:token` — revocable, expiring capability tokens (default none, up to 30 days); file delete or expiry kills the shares too
- Password change revokes all other sessions (session tokens are bound to the account's current password hash)
- Security headers on every response: CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`

## Chunked upload protocol

Vercel (and most serverless platforms) reject request bodies above ~4.5 MB **before** the route handler sees them. Therefore a single-request upload can never exceed that — the fix is protocol-level chunking:

```
Browser                          Server                       Telegram
   |  POST {action:"init",         |                             |
   |   name, mime, size, sha256}   |  validate meta + allowlist  |
   |  ---------------------------> |  create upload_sessions row |
   |  <- {uploadId, chunkSize}     |                             |
   |                               |                             |
   |  POST multipart               |                             |
   |   uploadId, partIndex,        |  size-check part,           |
   |   chunk (3 MiB)      -------> |  magic-check part 0,  ----> |  sendDocument(part)
   |  <- {ok, partIndex}           |  insert file_parts row      |
   |            ...repeat...       |                             |
   |                               |                             |
   |  POST {action:"complete",     |  re-download parts,         |
   |   uploadId}        ---------> |  verify SHA-256,     ----->  |  (delete dupes if any)
   |  <- {id, url}                 |  insert files row           |
```

Design properties:

- Every HTTP request body stays ≤ ~3 MiB — no platform limit can be hit.
- Non-final parts must be exactly 3 MiB; only the last part is short. A short middle part is rejected, so byte offsets can never silently shift.
- The client-declared SHA-256 is **verified server-side** at `complete` by re-downloading every stored part and hashing the stream. A mismatch (corrupted upload) drops all staging. Deduplication therefore trusts real bytes, not client claims.
- `complete` is idempotent: a retry after a lost response returns the already-created file; two concurrent completes cannot duplicate rows (the PK race is caught and answered idempotently).
- Part uploads are idempotent too: re-sending an already-stored part with the same size returns success without re-uploading.
- Every part is an individual Telegram document (far below the 50 MB `sendDocument` cap), and serving streams them concatenated in order.

Limits:

| Limit | Value | Why |
|---|---|---|
| Max file size | 50 MB | Telegram Bot API `sendDocument` cap (cloud) |
| Direct (single-request) upload | 20 MB | Telegram `getFile` cannot download files > 20 MB — larger single blobs would be stored but unservable |
| Chunk size | 3 MiB | Stays under the 4.5 MB platform body cap with multipart overhead |
| Abandoned session lifetime | 24 h | Janitored (Telegram parts + staging rows deleted) |

The browser client (`src/app/page.tsx`) picks the path automatically: files ≤ 3 MB go in one request, larger files run the full protocol with per-part retry and a progress bar.

## API

All endpoints are JSON. Auth via session cookie or `Authorization: Bearer <api_key>`.

### Upload

```bash
# single file (anonymous = public link; keep the request under 4MB)
curl -F 'file=@photo.jpg' http://localhost:3000/api/upload

# multi-file, authenticated (result files are private to the account)
curl -H 'Authorization: Bearer tb_...' -F 'file=@a.jpg' -F 'file=@b.pdf' http://localhost:3000/api/upload

# with expiration (TTL in seconds, 60..2592000)
curl -H 'Authorization: Bearer tb_...' -F 'file=@doc.pdf' -F 'ttl=86400' http://localhost:3000/api/upload
```

Files above 3 MB must use the chunked protocol (the bundled web UI does this automatically; CLI users should split similarly). Errors are always JSON, never HTML: invalid JSON bodies, unknown actions, and malformed form data all answer `{"error": ...}` with the proper status.

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

Key is shown once at creation. Revoke with `DELETE /api/keys`. Creation is rate-limited per account.

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

# edit / delete own comment
curl -X PATCH -H 'Content-Type: application/json' -d '{"commentId":"...","body":"edited"}' http://localhost:3000/api/pastes/:id/comments
curl -X DELETE -H 'Content-Type: application/json' -d '{"commentId":"..."}' http://localhost:3000/api/pastes/:id/comments
```

### Share a private file

```bash
# list / create / revoke (owner only)
curl -b session http://localhost:3000/api/files/:id/shares
curl -b session -X POST -H 'Content-Type: application/json' -d '{"ttl":86400}' http://localhost:3000/api/files/:id/shares
curl -b session -X DELETE -H 'Content-Type: application/json' -d '{"id":"share_id"}' http://localhost:3000/api/files/:id/shares

# anyone with the link can fetch bytes (no owner gate)
curl http://localhost:3000/s/:token
```

Share tokens are long capabilities (`sh_` + 192-bit). They never weaken the owner gate — `/raw` stays private. Deleting the file or letting it expire revokes all its shares.

```bash
curl http://localhost:3000/api/profile            # own profile (session)
curl -X PATCH -H 'Content-Type: application/json' -d '{"name":"New Name"}' http://localhost:3000/api/profile
curl -X POST -H 'Content-Type: application/json' -d '{"current_password":"old","new_password":"newpass123"}' http://localhost:3000/api/profile/password
curl -F 'avatar=@photo.png' http://localhost:3000/api/profile/avatar
```

Changing the password signs out every other device: session tokens embed a prefix of the account's current password hash, so rotating the hash invalidates all previously issued tokens. The current device receives a fresh cookie automatically.

## Pages

| Path | Description |
|---|---|
| `/` | Upload page (multi-file drag-drop, chunked progress, login/signup) |
| `/i/:id` | File preview (image/video/audio/text) — public for anonymous files, owner-only for account files |
| `/raw/:id` or `/raw/:id/:filename` | Raw file (download or inline) — same access model, supports HTTP Range |
| `/my` | My Files + API Keys management |
| `/s/:token` | Share link for a private file (revocable, expiring) |
| `/pastebin` | Public paste feed (copy, comment, like, star) |
| `/paste/new` | Create a paste |
| `/paste/:id` | Paste detail + comments |
| `/profile` | Profile settings (name, password, photo) |
| `/avatar/:id` | Public profile photo |

## Tech

- Next.js 16 (App Router), React 19
- SQLite (`node:sqlite`) local dev, Postgres (`pg`) when `DATABASE_URL` set — same SQL, dual-backend facade
- `node:crypto` for SHA-256 + scrypt auth (OWASP-recommended parameters, versioned hash format with transparent legacy upgrade)
- Telegram Bot API for blob storage; `deleteMessage` purges on delete/expiry
- Upstash Redis REST for distributed rate limiting (optional, per-IP and per-account)
- Runtime deps: Next.js, React, `pg`

## Deploy to Vercel

1. Set `DATABASE_URL` (Neon/Postgres) — the app auto-switches from SQLite to Postgres when set (Vercel FS is read-only)
2. Set the other env vars: `SESSION_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_STORAGE_CHAT_ID`, optionally `UPSTASH_REDIS_REST_URL`/`TOKEN` and `CRON_SECRET`
3. Deploy; Node version is pinned via `engines` in `package.json`

Rate limiter uses Upstash Redis when `UPSTASH_REDIS_REST_*` is set; falls back to in-memory locally (single-process only — always set Upstash in production).

The purge janitor runs hourly via Vercel cron (`vercel.json`), plus probabilistically on uploads and lazily on file access, so expiry is enforced even if cron is unreachable.

Postgres path is covered by tests via PGlite (real Postgres in WASM) — run `npm test`. See [SECURITY.md](SECURITY.md) for the full security model and [ARCHITECTURE.md](ARCHITECTURE.md) for internal design.
