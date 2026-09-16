import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getSessionUserId } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ logged_in: false });
  }
  const row = await db.get<{ email: string }>("SELECT email FROM users WHERE id = ?", userId);
  if (!row) return NextResponse.json({ logged_in: false });
  return NextResponse.json({ logged_in: true, email: row.email });
}