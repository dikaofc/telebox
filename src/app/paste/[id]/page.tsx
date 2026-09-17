import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createHash } from "node:crypto";
import db from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { SiteNav } from "@/components/site-nav";
import { CodeBlock } from "@/components/code-block";
import { PasteActions } from "@/components/paste-actions";
import { CommentSection } from "@/components/comment-section";
import { IconArrowLeft } from "@/components/icons";

export const runtime = "nodejs";

type PasteRow = {
  id: string; title: string; content: string; language: string;
  created_at: number; author_name: string;
};
type CommentRow = { id: string; author_name: string; body: string; created_at: number };

/** server-side actor: session user if logged in, else IP hash (mirrors API). */
async function serverActor(): Promise<string> {
  const userId = await getSessionUserId();
  if (userId) return `user:${userId}`;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
  const secret = process.env.SESSION_SECRET || "dev-secret-change-in-production";
  const hash = createHash("sha256").update(`${ip}:${secret}`).digest("hex").slice(0, 16);
  return `ip:${hash}`;
}

export default async function PastePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await serverActor();

  const row = await db.get<PasteRow>(
    "SELECT id, title, content, language, created_at, author_name FROM pastes WHERE id = ?",
    id
  );
  if (!row) notFound();

  const flags = await db.get<{ liked: number; starred: number }>(
    `SELECT
       EXISTS(SELECT 1 FROM paste_likes l WHERE l.paste_id = ? AND l.actor = ?) AS liked,
       EXISTS(SELECT 1 FROM paste_stars s WHERE s.paste_id = ? AND s.actor = ?) AS starred`,
    id, actor, id, actor
  );
  const counts = await db.get<{ c1: number; c2: number }>(
    `SELECT
       (SELECT COUNT(*) FROM paste_likes l WHERE l.paste_id = ?) AS c1,
       (SELECT COUNT(*) FROM paste_stars s WHERE s.paste_id = ?) AS c2`,
    id, id
  );
  const comments = await db.all<CommentRow>(
    "SELECT id, author_name, body, created_at FROM paste_comments WHERE paste_id = ? ORDER BY created_at ASC",
    id
  );

  return (
    <>
      <SiteNav showNewPaste />
      <main className="container">
        <div className="page-header">
          <div style={{ minWidth: 0 }}>
            <h1 className="page-title" style={{ wordBreak: "break-all" }}>{row.title}</h1>
            <div className="card-meta">
              {row.author_name || "anonymous"} &middot; {new Date(row.created_at).toLocaleString()} &middot; <span className="badge">{row.language}</span>
            </div>
          </div>
          <a href="/pastebin" className="link-btn" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <IconArrowLeft size={14} /> back
          </a>
        </div>

        <CodeBlock code={row.content} language={row.language} className="code-full" />

        <PasteActions
          id={row.id}
          content={row.content}
          initialLiked={!!flags?.liked}
          initialStarred={!!flags?.starred}
          initialLikes={counts?.c1 ?? 0}
          initialStars={counts?.c2 ?? 0}
        />

        <CommentSection
          pasteId={row.id}
          initial={comments.map((c) => ({
            id: c.id,
            author: c.author_name || "anonymous",
            body: c.body,
            created_at: new Date(c.created_at).toISOString(),
          }))}
        />
      </main>
    </>
  );
}