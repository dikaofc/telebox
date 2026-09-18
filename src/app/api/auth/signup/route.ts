import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { createSessionToken, setSessionCookie } from "@/lib/session";

import { checkRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/session";

export const runtime = "nodejs";

// Practical email shape: one "@", no whitespace, printable, length-capped.
// Full RFC 5322 compliance is not the goal here — rejecting obvious garbage
// and normalizing case is enough; the UNIQUE constraint is the real guard.
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const MAX_PASSWORD_LEN = 1024; // scrypt input guard (DoS via huge inputs)

export async function POST(req: NextRequest) {
  const rl = await checkRateLimit(`signup:${clientIp(req)}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }

  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return NextResponse.json({ error: "email and password required" }, { status: 400 });
  }

  const email = String(body.email).toLowerCase().trim();
  const password = String(body.password);
  const name = String(body.name ?? "").trim().slice(0, 60);

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "password must be at least 8 characters" }, { status: 400 });
  }
  if (password.length > MAX_PASSWORD_LEN) {
    return NextResponse.json({ error: "password too long" }, { status: 400 });
  }

  const existing = await db.get("SELECT id FROM users WHERE email = ?", email);
  if (existing) {
    return NextResponse.json({ error: "email already registered" }, { status: 409 });
  }

  const hash = await hashPassword(password);
  try {
    await db.run("INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)", email, hash, name, Date.now());
  } catch (e) {
    // Race: two concurrent signups passed the SELECT check; UNIQUE fails one.
    if (String(e).includes("UNIQUE") || String(e).includes("unique") || String(e).includes("duplicate")) {
      return NextResponse.json({ error: "email already registered" }, { status: 409 });
    }
    throw e;
  }
  const row = await db.get<{ id: number }>("SELECT id FROM users WHERE email = ?", email);
  if (!row) return NextResponse.json({ error: "signup failed, please retry" }, { status: 500 });

  const token = createSessionToken(row.id, hash.slice(0, 16));
  const res = NextResponse.json({ ok: true, email }, { status: 201 });
  const cookie = setSessionCookie(token);
  res.headers.set("Set-Cookie", cookie["Set-Cookie"]);
  return res;
}
