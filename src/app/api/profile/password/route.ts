import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { getSessionUser, createSessionToken, setSessionCookie } from "@/lib/session";

export const runtime = "nodejs";

const MAX_PASSWORD_LEN = 1024;

/** Change password: current + new (min 8). Revokes every other session. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const current = String(body?.current_password ?? "");
  const next = String(body?.new_password ?? "");
  if (next.length < 8) return NextResponse.json({ error: "new password must be at least 8 characters" }, { status: 400 });
  if (next.length > MAX_PASSWORD_LEN) return NextResponse.json({ error: "new password too long" }, { status: 400 });

  const row = await db.get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", user.id);
  if (!row || !(await verifyPassword(current, row.password_hash)).ok) {
    return NextResponse.json({ error: "current password is incorrect" }, { status: 403 });
  }

  const newHash = await hashPassword(next);
  await db.run("UPDATE users SET password_hash = ? WHERE id = ?", newHash, user.id);

  // Sessions carry the old hash prefix, so they are all dead now — issue the
  // caller a fresh token bound to the new hash so the current device stays
  // logged in while every other device is signed out.
  const token = createSessionToken(user.id, newHash.slice(0, 16));
  const res = NextResponse.json({ ok: true });
  const cookie = setSessionCookie(token);
  res.headers.set("Set-Cookie", cookie["Set-Cookie"]);
  return res;
}
