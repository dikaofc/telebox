# Security model

This document describes telebox's threat model and the concrete controls in the codebase. It is written so an auditor (human or AI agent) can verify each claim against a file path.

## Accounts & sessions

- **Password storage** — `src/lib/auth.ts`: scrypt with OWASP-recommended parameters (N=2^17, r=8, p=1, 64-byte key, 16-byte random salt). Stored versioned (`scrypt:v17:<salt>:<hash>`). Rows hashed at the legacy cost (N=2^14) still verify and are transparently rehashed on the next successful login. Verification is constant-time (`timingSafeEqual`), never throws on malformed input, and returns no info beyond ok/not-ok.
- **Login** — `src/app/api/auth/login/route.ts`: unknown email and wrong password both execute the full scrypt work (`referenceHash()`), so response timing does not reveal which emails are registered. Rate-limited 10/min per IP.
- **Signup** — `src/app/api/auth/signup/route.ts`: email shape validation, password length bounds (8–1024), UNIQUE constraint + duplicate-race handling. Rate-limited 5/min per IP.
- **Session cookies** — `src/lib/session.ts`: HMAC-SHA256 signed payload (userId, hash prefix, exp), `HttpOnly`, `SameSite=Lax`, `Secure` in production, 30-day max age. The signing secret is required in production (fail-closed — the app refuses to operate with a missing secret rather than falling back to a guessable one).
- **Session revocation** — tokens embed a 16-char prefix of the account's current password hash; every authenticated request re-checks it against the DB (`getSessionUserIdFromCookie`). Changing the password (`/api/profile/password`) rotates the hash, which instantly invalidates every other session. Only the current device gets a fresh cookie. A stolen cookie can therefore always be neutralized by a password change.
- **API keys** — `src/app/api/keys/route.ts`: 192-bit random `tb_` keys shown once, stored only as SHA-256 hashes. Bearer auth is accepted wherever sessions are (`resolveUserId`). Key strings are length-checked before hashing; `last_used_at` is updated on use.

## Uploads & stored content

- **MIME allowlist + magic bytes** — `src/lib/validation.ts`: extension↔mime consistency plus signature sniffing of the first 512 bytes. Executable formats (`.exe`, `.bat`, `.sh`, …) are not in the allowlist. Client-declared Content-Type is never trusted.
- **Chunked integrity** — `src/lib/multipart.ts` + upload route: non-final parts must be exactly 3 MiB; the client's SHA-256 claim is verified at `complete` by re-downloading and hashing every stored part (`hashStoredParts` in `raw-serve.ts`). Mismatched staging is destroyed, so dedup metadata never reflects bytes that were not verified.
- **Owner-scoped dedup** — identical bytes uploaded by a different account never leak the first account's link (queries filter on `user_id`).
- **SVG** — served only as `attachment` (never inline), and the preview page shows source text, never renders it, neutering script-in-SVG.
- **Avatars** — image-only allowlist (jpeg/png/webp), 2 MB cap, generic magic-byte validation on top; the serving route clamps the mime to the allowlist.
- **Abandoned uploads** — staging sessions and orphan Telegram parts are janitored after 24 h so failed uploads cannot leak storage.

## Serving

- **Owner gate** — `/raw/:id`, `/i/:id`, `GET /api/files/:id` return 404 for both missing files and wrong-owner requests (no existence oracle). `/s/:token` is a 192-bit capability; missing/revoked/expired tokens all read 404.
- **Response hardening** — `X-Content-Type-Options: nosniff` on all file responses; `Content-Disposition` derived from `dl=1` and mime; filenames encoded via RFC 5987.
- **Range requests** — `parseRange` in `raw-serve.ts` implements 206/416 correctly; malformed or unsatisfiable headers never crash the route.
- **Expiry** — expired files are purged (row + Telegram blob + shares) on access, by daily cron (Vercel Hobby maximum), and probabilistically on upload.

## Abuse control

- **Rate limits** (`src/lib/rate-limit.ts`): per-IP or per-account keyed buckets backed by Upstash Redis (atomic INCR+EXPIRE, 3 s timeout, fail-open on infra error so an outage cannot lock users out) with an in-memory fallback for single-process dev. Applied to signup, login, upload, paste create, comments, likes/stars, avatar upload, and API-key creation.
- **Anonymous reaction identity** — `resolveActor` derives a salted IP hash (SESSION_SECRET as salt) so anonymous users can retract their own votes but cannot forge another anon's identity.
- **Cron endpoint** — `src/app/api/cron/purge/route.ts`: optional `CRON_SECRET` gate, compared with `timingSafeEqual` (secret cannot be read byte-by-byte across requests).

## Headers & browser defense

`next.config.ts` sets on every response:

- `Content-Security-Policy`: `default-src 'self'`; scripts/styles self + inline only (inline is required by the React inline-style approach); `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`.
- `X-Frame-Options: DENY` (clickjacking), `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` disabling camera/microphone/geolocation.

All user-generated content (paste bodies, comments, titles, filenames, display names) is rendered as React text nodes — auto-escaped, never via `dangerouslySetInnerHTML`. CSP is the second layer, not the only one.

## Input validation summary

| Input | Bound | Where |
|---|---|---|
| Paste title | ≤ 200 chars, trimmed | `src/lib/paste.ts` |
| Paste content | ≤ 100 KB | `src/lib/paste.ts` |
| Comment body | ≤ 2000 chars | `src/lib/paste.ts` |
| Display name | ≤ 60 chars, character allowlist | `src/app/api/profile/route.ts` |
| File name | ≤ 255 chars | `src/lib/multipart.ts` |
| File size | ≤ 50 MB total, ≤ 20 MB direct | `src/lib/multipart.ts` |
| TTL | clamped 60 s–30 d | upload route, `src/lib/share.ts` |
| Email | shape + length, lowercased | signup route |
| Password | 8–1024 chars | signup/password routes |
| Percent-encoded path segments | decoded defensively (no URIError) | `src/app/raw/[...path]/route.ts` |

## Residual risks (accepted / documented)

- Telegram is a third party: blob confidentiality assumes the private channel stays private (single bot, no invites).
- `getFile` URLs are bot-locked and short-lived; the app proxies them and sets no-cache semantics for expiring files, but a determined client can re-request.
- The in-memory rate limiter is per-process; without Upstash, limits are per-lambda-instance. Production deployments should set Upstash.
- `x-forwarded-for` is trusted as set by the platform. On Vercel this is safe (platform overwrites it); self-hosting behind a naive proxy would let clients spoof IPs for rate limiting/anonymous actor keys.
