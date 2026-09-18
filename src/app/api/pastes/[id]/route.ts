import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { resolveActor } from "@/lib/session";

export const runtime = "nodejs";

type PasteRow = {
  id: string; title: string; content: string; language: string;
  user_id: number; author_name: string; created_at: number;
};

/** Public paste detail + counts + viewer flags. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await resolveActor(req);

  const row = await db.get<PasteRow>(
    "SELECT id, title, content, language, user_id, author_name, created_at FROM pastes WHERE id = ?",
    id
  );
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const counts = (await db.get<{ like_count: number; star_count: number; comment_count: number }>(
    `SELECT
       (SELECT COUNT(*) FROM paste_likes l WHERE l.paste_id = ?) AS like_count,
       (SELECT COUNT(*) FROM paste_stars s WHERE s.paste_id = ?) AS star_count,
       (SELECT COUNT(*) FROM paste_comments c WHERE c.paste_id = ?) AS comment_count`,
    id, id, id
  )) ?? { like_count: 0, star_count: 0, comment_count: 0 };

  const flags = await db.get<{ liked: number; starred: number }>(
    `SELECT
       EXISTS(SELECT 1 FROM paste_likes l WHERE l.paste_id = ? AND l.actor = ?) AS liked,
       EXISTS(SELECT 1 FROM paste_stars s WHERE s.paste_id = ? AND s.actor = ?) AS starred`,
    id, actor, id, actor
  );

  const comments = await db.all<{ id: string; user_id: number; author_name: string; body: string; created_at: number; avatar_file_id: string | null }>(
    `SELECT c.id, c.user_id, c.author_name, c.body, c.created_at, u.avatar_file_id
     FROM paste_comments c LEFT JOIN users u ON c.user_id = u.id
    WHERE c.paste_id = ? ORDER BY c.created_at ASC LIMIT 200`,
    id
  );

  return NextResponse.json({
    id: row.id, title: row.title, content: row.content, language: row.language,
    author: row.author_name || "anonymous",
    created_at: new Date(row.created_at).toISOString(),
    like_count: counts.like_count, star_count: counts.star_count, comment_count: counts.comment_count,
    liked: !!flags?.liked, starred: !!flags?.starred,
    comments: comments.map((c) => ({
      id: c.id,
      author: c.author_name || "anonymous",
      avatar_url: c.user_id ? (c.avatar_file_id ? `/avatar/${c.user_id}` : null) : null,
      body: c.body,
      created_at: new Date(c.created_at).toISOString(),
      user_id: c.user_id,
    })),
  });
}

/** Owner-only delete. Anonymous pastes have no owner and can't be deleted. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await resolveActor(req);
  const userId = actor.startsWith("user:") ? Number(actor.slice(5)) : 0;
  if (!userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const row = await db.get<{ user_id: number }>("SELECT user_id FROM pastes WHERE id = ?", id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.user_id !== userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  await db.run("DELETE FROM pastes WHERE id = ?", id);
  await db.run("DELETE FROM paste_likes WHERE paste_id = ?", id);
  await db.run("DELETE FROM paste_stars WHERE paste_id = ?", id);
  await db.run("DELETE FROM paste_comments WHERE paste_id = ?", id);
  return NextResponse.json({ ok: true });
}