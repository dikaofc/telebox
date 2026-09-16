import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";

/** Change password: current + new (min 8). */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const current = String(body?.current_password ?? "");
  const next = String(body?.new_password ?? "");
  if (next.length < 8) return NextResponse.json({ error: "new password must be at least 8 characters" }, { status: 400 });

  const row = await db.get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", user.id);
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    return NextResponse.json({ error: "current password is incorrect" }, { status: 403 });
  }

  await db.run("UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword(next), user.id);
  return NextResponse.json({ ok: true });
}