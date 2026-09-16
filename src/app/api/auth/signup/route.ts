import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { createSessionToken, setSessionCookie } from "@/lib/session";

import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "unknown";
  const rl = await checkRateLimit(`signup:${ip}`, 5, 60_000);
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

  if (password.length < 8) {
    return NextResponse.json({ error: "password must be at least 8 characters" }, { status: 400 });
  }
  if (!email.includes("@") || email.length > 254) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }

  const existing = await db.get("SELECT id FROM users WHERE email = ?", email);
  if (existing) {
    return NextResponse.json({ error: "email already registered" }, { status: 409 });
  }

  const hash = await hashPassword(password);
  await db.run("INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)", email, hash, name, Date.now());
  const row = await db.get<{ id: number }>("SELECT id FROM users WHERE email = ?", email);
  const userId = row?.id ?? 0;

  const token = createSessionToken(userId);
  const res = NextResponse.json({ ok: true, email }, { status: 201 });
  const cookie = setSessionCookie(token);
  res.headers.set("Set-Cookie", cookie["Set-Cookie"]);
  return res;
}