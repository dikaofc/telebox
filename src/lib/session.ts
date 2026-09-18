import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import db from "@/lib/db";

// Fail closed in production: predictable fallback secret would let anyone
// forge sessions. Dev keeps a fixed default so local runs "just work".
const SECRET =
  process.env.NODE_ENV === "production"
    ? process.env.SESSION_SECRET || ""
    : process.env.SESSION_SECRET || "dev-secret-change-in-production";

function sessionSecret(): string {
  if (!SECRET) throw new Error("SESSION_SECRET is required in production");
  return SECRET;
}
const COOKIE_NAME = "tb_session";
const MAX_AGE = 60 * 60 * 24 * 30;

function sign(payload: string): string {
  const sig = createHmac("sha256", sessionSecret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function unsign(signed: string): string | null {
  const idx = signed.lastIndexOf(".");
  if (idx === -1) return null;
  const payload = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = createHmac("sha256", sessionSecret()).update(payload).digest("hex");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? payload : null;
}

/** Shared salt for anonymous actor hashes. Same fail-closed secret as sessions. */
export function actorSalt(): string {
  return sessionSecret();
}

type SessionPayload = { userId: number; pw: string; exp: number };

/**
 * Session tokens are bound to the account's current password hash: a token is
 * only honored while `pw` still equals the first 16 hex chars of the account's
 * stored scrypt hash. Changing the password (or hashing at new parameters on
 * login) instantly invalidates every other session for that account, so a
 * stolen cookie can always be killed by rotating the password. The token
 * carries no secret material — `pw` is a hash prefix, never the hash itself.
 */
export function createSessionToken(userId: number, passwordHashPrefix: string): string {
  const payload: SessionPayload = { userId, pw: passwordHashPrefix, exp: Date.now() + MAX_AGE * 1000 };
  return sign(JSON.stringify(payload));
}

async function getSessionUserIdFromCookie(): Promise<number | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const json = unsign(raw);
  if (!json) return null;
  try {
    const p: SessionPayload = JSON.parse(json) as SessionPayload;
    if (typeof p.userId !== "number" || typeof p.pw !== "string" || typeof p.exp !== "number") return null;
    if (Date.now() > p.exp) return null;
    // Bind check: token must match the account's current password hash prefix.
    const row = await db.get<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = ?",
      p.userId
    );
    if (!row) return null;
    const current = row.password_hash.slice(0, 16);
    const a = Buffer.from(p.pw, "utf8");
    const b = Buffer.from(current, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return p.userId;
  } catch {
    return null;
  }
}

export async function getSessionUserId(): Promise<number | null> {
  return getSessionUserIdFromCookie();
}

async function getUserIdFromApiKey(req: NextRequest): Promise<number | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const key = auth.slice(7);
  if (key.length < 16 || key.length > 256) return null;
  const hash = createHash("sha256").update(key).digest("hex");
  const row = await db.get<{ id: number; user_id: number }>("SELECT id, user_id FROM api_keys WHERE key_hash = ?", hash);
  if (!row) return null;
  await db.run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", Date.now(), row.id);
  return row.user_id;
}

/** Cookie session first, then API key fallback. Anonymous users resolve to 0. */
export async function resolveUserId(req: NextRequest): Promise<number> {
  const fromCookie = await getSessionUserIdFromCookie();
  if (fromCookie) return fromCookie;
  return (await getUserIdFromApiKey(req)) ?? 0;
}

/** Server-component variant: reads cookies + Authorization via headers(). */
export async function resolveUserIdFromHeaders(): Promise<number> {
  const { headers } = await import("next/headers");
  const h = await headers();
  const fromCookie = await getSessionUserIdFromCookie();
  if (fromCookie) return fromCookie;
  const auth = h.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const key = auth.slice(7);
    if (key.length >= 16 && key.length <= 256) {
      const hash = createHash("sha256").update(key).digest("hex");
      const row = await db.get<{ id: number; user_id: number }>(
        "SELECT id, user_id FROM api_keys WHERE key_hash = ?",
        hash
      );
      if (row) {
        await db.run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", Date.now(), row.id);
        return row.user_id;
      }
    }
  }
  return 0;
}

export type SessionUser = {
  id: number;
  email: string;
  name: string;
  avatar_file_id: string | null;
};

/** Current session user record (name/avatar live on users). */
export async function getSessionUser(): Promise<SessionUser | null> {
  const userId = await getSessionUserIdFromCookie();
  if (!userId) return null;
  const row = await db.get<SessionUser>(
    "SELECT id, email, name, avatar_file_id FROM users WHERE id = ?",
    userId
  );
  return row ?? null;
}

/**
 * Stable identity for likes/stars/comments. Real accounts get `user:<id>`;
 * anonymous visitors get an IP-derived hash so they can retract their own
 * vote without being able to spoof another anon's.
 */
export async function resolveActor(req: NextRequest): Promise<string> {
  const fromCookie = await getSessionUserIdFromCookie();
  if (fromCookie) return `user:${fromCookie}`;
  const apiKeyUserId = await getUserIdFromApiKey(req);
  if (apiKeyUserId) return `user:${apiKeyUserId}`;
  const ip = clientIp(req);
  const hash = createHash("sha256").update(`${ip}:${sessionSecret()}`).digest("hex").slice(0, 16);
  return `ip:${hash}`;
}

/** Server-component actor variant for RSC pages (mirrors resolveActor). */
export async function resolveActorFromHeaders(): Promise<string> {
  const userId = await getSessionUserIdFromCookie();
  if (userId) return `user:${userId}`;
  const { headers } = await import("next/headers");
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
  const hash = createHash("sha256").update(`${ip}:${sessionSecret()}`).digest("hex").slice(0, 16);
  return `ip:${hash}`;
}

/**
 * Best-effort client IP from proxy headers. Only Vercel (which overwrites
 * x-forwarded-for) is trusted; the `known` flag lets callers decide whether
 * an IP-derived rate limit or actor key is meaningful.
 */
export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "unknown";
}

export function setSessionCookie(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return {
    "Set-Cookie": `${COOKIE_NAME}=${token}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${MAX_AGE}`,
  };
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return {
    "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=0`,
  };
}
