import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { newId } from "@/lib/id";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveActor, clientIp } from "@/lib/session";
import { validateComment } from "@/lib/paste";

export const runtime = "nodejs";

/** List comments for a paste. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const paste = await db.get("SELECT id FROM pastes WHERE id = ?", id);
  if (!paste) return NextResponse.json({ error: "not found" }, { status: 404 });
  const rows = await db.all<{
    id: string; user_id: number; author_name: string; body: string; created_at: number; avatar_file_id: string | null;
  }>(
    `SELECT c.id, c.user_id, c.author_name, c.body, c.created_at, u.avatar_file_id
     FROM paste_comments c
     LEFT JOIN users u ON c.user_id = u.id
    WHERE c.paste_id = ?
    ORDER BY c.created_at ASC
    LIMIT 200`,
    id
  );
  return NextResponse.json({
    comments: rows.map((c) => ({
      id: c.id,
      author: c.author_name || "anonymous",
      avatar_url: c.user_id ? (c.avatar_file_id ? `/avatar/${c.user_id}` : null) : null,
      body: c.body,
      created_at: new Date(c.created_at).toISOString(),
      user_id: c.user_id,
    })),
  });
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
  const user = userId ? await db.get<{ name: string; avatar_file_id: string | null }>("SELECT name, avatar_file_id FROM users WHERE id = ?", userId) : null;

  const commentId = newId();
  const now = Date.now();
  await db.run(
    "INSERT INTO paste_comments (id, paste_id, user_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    commentId, id, userId, user?.name ?? "", v.body, now
  );

  return NextResponse.json(
    {
      id: commentId,
      author: user?.name || "anonymous",
      avatar_url: userId ? (user?.avatar_file_id ? `/avatar/${userId}` : null) : null,
      body: v.body,
      created_at: new Date(now).toISOString(),
      user_id: userId,
    },
    { status: 201 }
  );
}

/** Delete comment (owner only). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = (await req.json().catch(() => null)) as { commentId?: unknown } | null;
  const commentId = typeof parsed?.commentId === "string" ? parsed.commentId : "";
  if (!commentId) return NextResponse.json({ error: "commentId required" }, { status: 400 });

  const actor = await resolveActor(req);
  const userId = actor.startsWith("user:") ? Number(actor.slice(5)) : null;
  if (!userId) return NextResponse.json({ error: "login required" }, { status: 401 });

  const comment = await db.get<{ user_id: number; paste_id: string }>("SELECT user_id, paste_id FROM paste_comments WHERE id = ?", commentId);
  if (!comment || comment.paste_id !== id) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (comment.user_id !== userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  await db.run("DELETE FROM paste_comments WHERE id = ?", commentId);
  return NextResponse.json({ ok: true });
}

/** Edit comment (owner only). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = (await req.json().catch(() => null)) as { commentId?: unknown; body?: unknown } | null;
  const commentId = typeof parsed?.commentId === "string" ? parsed.commentId : "";
  if (!commentId || !parsed?.body) return NextResponse.json({ error: "commentId and body required" }, { status: 400 });
  const body = parsed.body;

  const v = validateComment(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const actor = await resolveActor(req);
  const userId = actor.startsWith("user:") ? Number(actor.slice(5)) : null;
  if (!userId) return NextResponse.json({ error: "login required" }, { status: 401 });

  const comment = await db.get<{ user_id: number; paste_id: string }>("SELECT user_id, paste_id FROM paste_comments WHERE id = ?", commentId);
  if (!comment || comment.paste_id !== id) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (comment.user_id !== userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  await db.run("UPDATE paste_comments SET body = ? WHERE id = ?", v.body, commentId);
  return NextResponse.json({ ok: true, body: v.body });
}
