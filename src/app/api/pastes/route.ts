import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { newId } from "@/lib/id";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveActor, clientIp } from "@/lib/session";
import { validatePaste } from "@/lib/paste";

export const runtime = "nodejs";

/** Public feed: newest first, like/star/comment counts, viewer's own flags. */
export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  const rows = await db.all<{
    id: string; title: string; snippet: string; language: string;
    user_id: number; author_name: string; created_at: number;
    like_count: number; star_count: number; comment_count: number;
    liked: number; starred: number;
  }>(
    `SELECT p.id, p.title, substr(p.content, 1, 200) AS snippet, p.language, p.user_id, p.author_name, p.created_at,
       (SELECT COUNT(*) FROM paste_likes l WHERE l.paste_id = p.id) AS like_count,
       (SELECT COUNT(*) FROM paste_stars s WHERE s.paste_id = p.id) AS star_count,
       (SELECT COUNT(*) FROM paste_comments c WHERE c.paste_id = p.id) AS comment_count,
       EXISTS(SELECT 1 FROM paste_likes l WHERE l.paste_id = p.id AND l.actor = ?) AS liked,
       EXISTS(SELECT 1 FROM paste_stars s WHERE s.paste_id = p.id AND s.actor = ?) AS starred
     FROM pastes p ORDER BY p.created_at DESC LIMIT 100`,
    actor, actor
  );

  return NextResponse.json({
    pastes: rows.map((r) => ({
      id: r.id, title: r.title, snippet: r.snippet, language: r.language,
      author: r.author_name || "anonymous",
      created_at: new Date(r.created_at).toISOString(),
      like_count: r.like_count, star_count: r.star_count, comment_count: r.comment_count,
      liked: !!r.liked, starred: !!r.starred,
    })),
  });
}

/** Create paste. Anonymous allowed (author_name falls back to "anonymous"). */
export async function POST(req: NextRequest) {
  const rl = await checkRateLimit(`paste:${clientIp(req)}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }

  const body = await req.json().catch(() => null);
  const v = validatePaste({ title: body?.title, content: body?.content, language: body?.language });
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const actor = await resolveActor(req);
  const userId = actor.startsWith("user:") ? Number(actor.slice(5)) : 0;
  const authorName = userId ? (await db.get<{ name: string }>("SELECT name FROM users WHERE id = ?", userId))?.name ?? "" : "";

  const id = newId();
  try {
    await db.run(
      "INSERT INTO pastes (id, title, content, language, user_id, author_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id, v.title, v.content, v.language, userId, authorName || "anonymous", Date.now()
    );
  } catch (e) {
    // Extremely unlikely (24-char random id collision); answer cleanly rather
    // than surfacing a 500 HTML page.
    console.error("paste insert failed", e);
    return NextResponse.json({ error: "create failed, please retry" }, { status: 500 });
  }

  return NextResponse.json({ id, url: `/paste/${id}` }, { status: 201 });
}