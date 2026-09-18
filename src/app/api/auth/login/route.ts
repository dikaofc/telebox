import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { verifyPassword, hashPassword, referenceHash } from "@/lib/auth";
import { createSessionToken, setSessionCookie, clientIp } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const rl = await checkRateLimit(`login:${clientIp(req)}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }

  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return NextResponse.json({ error: "email and password required" }, { status: 400 });
  }

  const email = String(body.email).toLowerCase().trim();
  const password = String(body.password);

  const row = await db.get<{ id: number; password_hash: string }>("SELECT id, password_hash FROM users WHERE email = ?", email);
  // Always run the same scrypt work so missing vs wrong-password logins take
  // the same time (login timing must not reveal which emails are registered).
  const result = await verifyPassword(password, row?.password_hash ?? referenceHash());
  if (!row || !result.ok) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  // Transparent upgrade: accounts created before the scrypt parameter bump
  // rehash at the current cost on first successful login. This also rotates
  // the hash — which, because sessions are bound to the hash prefix, signs
  // other devices out (intended: a successful login from new hardware should
  // be able to lock down the account).
  let currentHash = row.password_hash;
  if (result.needsRehash) {
    currentHash = await hashPassword(password);
    await db.run("UPDATE users SET password_hash = ? WHERE id = ?", currentHash, row.id);
  }

  const token = createSessionToken(row.id, currentHash.slice(0, 16));
  const res = NextResponse.json({ ok: true, email });
  const cookie = setSessionCookie(token);
  res.headers.set("Set-Cookie", cookie["Set-Cookie"]);
  return res;
}
