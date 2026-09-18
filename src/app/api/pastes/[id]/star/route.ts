import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveActor, clientIp } from "@/lib/session";

export const runtime = "nodejs";

/** Toggle star (star ↔ unstar). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rl = await checkRateLimit(`star:${clientIp(req)}`, 60, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }

  const actor = await resolveActor(req);
  const paste = await db.get("SELECT id FROM pastes WHERE id = ?", id);
  if (!paste) return NextResponse.json({ error: "not found" }, { status: 404 });

  const exists = await db.get("SELECT 1 FROM paste_stars WHERE paste_id = ? AND actor = ?", id, actor);

  if (exists) {
    await db.run("DELETE FROM paste_stars WHERE paste_id = ? AND actor = ?", id, actor);
  } else {
    try {
      await db.run("INSERT INTO paste_stars (paste_id, actor, created_at) VALUES (?, ?, ?)", id, actor, Date.now());
    } catch {
      // Concurrent toggle race on the (paste_id, actor) PK — treat as starred.
    }
  }

  const count = (await db.get<{ c: number }>("SELECT COUNT(*) AS c FROM paste_stars WHERE paste_id = ?", id))?.c ?? 0;
  return NextResponse.json({ starred: !exists, star_count: count });
}