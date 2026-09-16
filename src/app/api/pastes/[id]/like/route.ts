import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveActor } from "@/lib/session";

export const runtime = "nodejs";

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "unknown";
}

/** Toggle like (like ↔ unlike). The actor key enforces one vote per person. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rl = await checkRateLimit(`like:${clientIp(req)}`, 60, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }

  const actor = await resolveActor(req);
  const exists = await db.get("SELECT 1 FROM paste_likes WHERE paste_id = ? AND actor = ?", id, actor);
  const now = Date.now();

  if (exists) {
    await db.run("DELETE FROM paste_likes WHERE paste_id = ? AND actor = ?", id, actor);
  } else {
    await db.run("INSERT INTO paste_likes (paste_id, actor, created_at) VALUES (?, ?, ?)", id, actor, now);
  }

  const count = (await db.get<{ c: number }>("SELECT COUNT(*) AS c FROM paste_likes WHERE paste_id = ?", id))?.c ?? 0;
  return NextResponse.json({ liked: !exists, like_count: count });
}