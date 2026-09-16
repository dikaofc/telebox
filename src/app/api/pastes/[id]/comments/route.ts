import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { newId } from "@/lib/id";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveActor } from "@/lib/session";
import { validateComment } from "@/lib/paste";

export const runtime = "nodejs";

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "unknown";
}

/** Add comment to paste. Anonymous allowed; name falls back to "anonymous". */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rl = await checkRateLimit(`comment:${clientIp(req)}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }

  const paste = await db.get("SELECT id FROM pastes WHERE id = ?", id);
  if (!paste) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const v = validateComment(body?.body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const actor = await resolveActor(req);
  const userId = actor.startsWith("user:") ? Number(actor.slice(5)) : 0;
  const authorName = userId ? (await db.get<{ name: string }>("SELECT name FROM users WHERE id = ?", userId))?.name ?? "" : "";

  const commentId = newId();
  await db.run(
    "INSERT INTO paste_comments (id, paste_id, user_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    commentId, id, userId, authorName || "anonymous", v.body, Date.now()
  );

  return NextResponse.json(
    { id: commentId, author: authorName || "anonymous", body: v.body },
    { status: 201 }
  );
}