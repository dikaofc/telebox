import { createHmac, randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import db from "@/lib/db";

const SECRET = process.env.SESSION_SECRET || "dev-secret-change-in-production";
const COOKIE_NAME = "tb_session";
const MAX_AGE = 60 * 60 * 24 * 30;

function sign(payload: string): string {
  const sig = createHmac("sha256", SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function unsign(signed: string): string | null {
  const idx = signed.lastIndexOf(".");
  if (idx === -1) return null;
  const payload = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = createHmac("sha256", SECRET).update(payload).digest("hex");
  if (sig.length !== expected.length) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  let mismatch = false;
  for (let i = 0; i < a.length; i++) mismatch = mismatch || a[i] !== b[i];
  return mismatch ? null : payload;
}

type SessionPayload = { userId: number; exp: number };

export function createSessionToken(userId: number): string {
  const payload: SessionPayload = { userId, exp: Date.now() + MAX_AGE * 1000 };
  return sign(JSON.stringify(payload));
}

async function getSessionUserIdFromCookie(): Promise<number | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const json = unsign(raw);
  if (!json) return null;
  try {
    const p: SessionPayload = JSON.parse(json);
    if (Date.now() > p.exp) return null;
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
  const hash = createHash("sha256").update(key).digest("hex");
  const row = await db.get<{ id: number; user_id: number }>("SELECT id, user_id FROM api_keys WHERE key_hash = ?", hash);
  if (!row) return null;
  await db.run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", Date.now(), row.id);
  return row.user_id;
}

/** Cookie session first, then API key fallback. */
export async function resolveUserId(req: NextRequest): Promise<number> {
  const fromCookie = await getSessionUserIdFromCookie();
  if (fromCookie) return fromCookie;
  return (await getUserIdFromApiKey(req)) ?? 0;
}

export function setSessionCookie(token: string) {
  return {
    "Set-Cookie": `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`,
  };
}

export function clearSessionCookie() {
  return {
    "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  };
}