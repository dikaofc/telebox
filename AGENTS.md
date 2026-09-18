<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project notes for agents (telebox)

- **Read `ARCHITECTURE.md` and `SECURITY.md` first.** They document every design decision with file references. Keep them in sync with code changes — stale docs are bugs.
- **Dual-DB facade:** all SQL goes through `src/lib/db.ts` with SQLite-style `?` placeholders. SQL must work on both backends (SQLite + Postgres). Run `npm test` — `tests/pg.test.ts` verifies the Postgres dialect via PGlite.
- **Upload protocol invariants** (`src/lib/multipart.ts`, `src/app/api/upload/route.ts`): non-final parts are exactly `CHUNK_BYTES`; the client SHA-256 is verified server-side at `complete`; `complete` is idempotent (PK-race safe). Do not weaken any of these.
- **Telegram limits:** `sendDocument` ≤ 50 MB, `getFile` download ≤ 20 MB. Direct uploads are capped at `MAX_SINGLE_FILE_BYTES` (20 MB) for that reason — do not raise it without a self-hosted Bot API server.
- **Every Telegram RPC has a fetch timeout.** New fetches to external services must carry `AbortSignal.timeout(...)`.
- **Auth invariants:** passwords use the versioned scrypt format in `src/lib/auth.ts`; session tokens embed the current password-hash prefix (`src/lib/session.ts`) — any change to hashing must preserve the revocation property.
- **Error surface:** route handlers must never let throws escape as HTML 500 — parse JSON/form defensively and return structured JSON errors.
- **Never** add `dangerouslySetInnerHTML`, never trust client `Content-Type`, never weaken the owner gate on `/raw`/`/i` (404 for both missing and forbidden — no existence oracle).
- **Commands:** `npm run dev -- --webpack`, `npm test` (node --test), `npm run lint`, `npm run build`. Node ≥ 22.13.
