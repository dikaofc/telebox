import { notFound } from "next/navigation";
import { headers } from "next/headers";
import db from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { deleteMessage } from "@/lib/telegram";
import { TextPreview } from "@/components/text-preview";
import { CopyUrlButton } from "@/components/copy-url-button";

type Row = { name: string; mime: string; size: number; user_id: number | null };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// Anonymous uploads (user_id=0) are public share links. Files owned by a
// real account are private to that account — a different (or no) session
// gets the same result as a missing file.
async function canAccess(id: string, rowUserId: number | null): Promise<boolean> {
  if (rowUserId == null || rowUserId === 0) return true; // public file
  const userId = await getSessionUserId();
  return userId === rowUserId;
}

export default async function FilePreview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Absolute URL for the copy button; server components can't see the
  // browser location, so rebuild it from request headers.
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";

  const row = await db.get<Row>("SELECT name, mime, size, user_id FROM files WHERE id = ? AND deleted_at IS NULL", id);
  if (!row || !(await canAccess(id, row.user_id))) notFound();

  // Sweep: mark expired files deleted so they drop out of listings and
  // remove the Telegram blob. Server component — runs once per request, so
  // Date.now() here is a read of the request clock, not a re-render hazard.
  // eslint-disable-next-line react-hooks/purity -- server component, once per request
  const now = Date.now();
  const expired = await db.get<{ tg_chat_id: string; tg_message_id: number }>(
    "SELECT tg_chat_id, tg_message_id FROM files WHERE id = ? AND expires_at IS NOT NULL AND expires_at < ?",
    id,
    now
  );
  if (expired) {
    await db.run("UPDATE files SET deleted_at = ? WHERE id = ?", now, id);
    void deleteMessage(expired.tg_chat_id, expired.tg_message_id);
    notFound();
  }

  const safeName = row.name.replace(/[<>&"']/g, "");
  const mediaType = row.mime.split("/")[0];
  const isText = mediaType === "text" || row.mime === "application/json" || row.mime === "image/svg+xml";

  return (
    <main style={{ maxWidth: 720, margin: "4vh auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, margin: 0, wordBreak: "break-all" }}>{safeName}</h1>
      <p style={{ color: "#666", marginTop: 4, fontSize: 14 }}>
        {formatSize(row.size)} &middot; {row.mime.split("/").pop()?.toUpperCase()}
      </p>

      {mediaType === "image" && row.mime !== "image/svg+xml" && (
        <div style={{ marginTop: 24, textAlign: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/raw/${id}`}
            alt={safeName}
            style={{ maxWidth: "100%", height: "auto", borderRadius: 8 }}
          />
        </div>
      )}

      {mediaType === "video" && (
        <div style={{ marginTop: 24, textAlign: "center" }}>
          <video
            src={`/raw/${id}`}
            controls
            style={{ maxWidth: "100%", borderRadius: 8 }}
          />
        </div>
      )}

      {mediaType === "audio" && (
        <div style={{ marginTop: 24, textAlign: "center" }}>
          <audio src={`/raw/${id}`} controls style={{ width: "100%" }} />
        </div>
      )}

      {isText && <TextPreview id={id} mime={row.mime} />}

      {!["image", "video", "audio"].includes(mediaType) && !isText && (
        <p style={{ marginTop: 24, color: "#999" }}>Preview not available for this file type.</p>
      )}

      <div style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <a
          href={`/raw/${id}/${encodeURIComponent(row.name)}?dl=1`}
          download={safeName}
          style={{
            padding: "8px 16px",
            background: "#111",
            color: "#fff",
            textDecoration: "none",
            borderRadius: 6,
            fontSize: 14,
          }}
        >
          Download
        </a>
        <CopyUrlButton url={`${proto}://${host}/raw/${id}/${encodeURIComponent(row.name)}`} />
      </div>
    </main>
  );
}