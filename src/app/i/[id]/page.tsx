import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import db from "@/lib/db";
import { resolveUserIdFromHeaders } from "@/lib/session";
import { deleteStoredBlobs } from "@/lib/file-storage";
import { TEXT_PREVIEW_MAX_BYTES } from "@/lib/multipart";
import { TextPreview } from "@/components/text-preview";
import { CopyUrlButton } from "@/components/copy-url-button";
import { SiteNav } from "@/components/site-nav";
import { IconDownload, IconArrowLeft, IconFile } from "@/components/icons";

type Row = { name: string; mime: string; size: number; user_id: number | null };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// Anonymous uploads (user_id=0) are public share links. Files owned by a
// real account are private to that account — a different (or no) session
// gets the same result as a missing file. Auth is session or API key.
async function canAccess(rowUserId: number | null): Promise<boolean> {
  if (rowUserId == null || rowUserId === 0) return true; // public file
  const userId = await resolveUserIdFromHeaders();
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
  if (!row || !(await canAccess(row.user_id))) notFound();

  // Sweep: mark expired files deleted so they drop out of listings and
  // remove the Telegram blob. Server component — runs once per request, so
  // Date.now() here is a read of the request clock, not a re-render hazard.
  // eslint-disable-next-line react-hooks/purity -- server component, once per request
  const now = Date.now();
  const expired = await db.get<{ tg_chat_id: string; tg_message_id: number; storage_kind: string }>(
    "SELECT tg_chat_id, tg_message_id, storage_kind FROM files WHERE id = ? AND expires_at IS NOT NULL AND expires_at < ?",
    id,
    now
  );
  if (expired) {
    await db.run("UPDATE files SET deleted_at = ? WHERE id = ?", now, id);
    await db.run("DELETE FROM shares WHERE file_id = ?", id);
    void deleteStoredBlobs(id, { chatId: expired.tg_chat_id, messageId: expired.tg_message_id }, expired.storage_kind);
    notFound();
  }

  const safeName = row.name.replace(/[<>&"']/g, "");
  const mediaType = row.mime.split("/")[0];
  const isText = mediaType === "text" || row.mime === "application/json" || row.mime === "image/svg+xml";

  return (
    <>
      <SiteNav />
      <main className="container">
        <div className="page-header" style={{ alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 20, margin: "0 0 4px", wordBreak: "break-all", display: "flex", alignItems: "center", gap: 8 }}>
              <IconFile size={18} /> {safeName}
            </h1>
            <p style={{ color: "var(--muted)", margin: 0, fontSize: 14 }}>
              {formatSize(row.size)} &middot; {row.mime.split("/").pop()?.toUpperCase()}
            </p>
          </div>
          <Link href="/my" className="link-btn" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <IconArrowLeft size={14} /> files
          </Link>
        </div>

      {mediaType === "image" && row.mime !== "image/svg+xml" && (
        <div className="media-frame">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/raw/${id}`} alt={safeName} loading="lazy" />
        </div>
      )}

      {mediaType === "video" && (
        <div className="media-frame">
          <video src={`/raw/${id}`} controls playsInline preload="metadata" />
        </div>
      )}

      {mediaType === "audio" && (
        <div className="media-frame">
          <audio src={`/raw/${id}`} controls />
        </div>
      )}

      {isText && row.size <= TEXT_PREVIEW_MAX_BYTES && <TextPreview id={id} mime={row.mime} />}

      {isText && row.size > TEXT_PREVIEW_MAX_BYTES && (
        <p className="muted" style={{ marginTop: 24 }}>Preview not available for large text files — use Download.</p>
      )}

      {["image", "video", "audio"].includes(mediaType) === false && !isText && (
        <p className="muted" style={{ marginTop: 24 }}>Preview not available for this file type.</p>
      )}

      <div className="card-actions" style={{ marginTop: 24 }}>
        <a
          href={`/raw/${id}/${encodeURIComponent(row.name)}?dl=1`}
          download={safeName}
          className="btn btn-primary"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <IconDownload size={15} />
          Download
        </a>
        <CopyUrlButton url={`${proto}://${host}/raw/${id}/${encodeURIComponent(row.name)}`} />
      </div>
      </main>
    </>
  );
}