import { notFound } from "next/navigation";
import db from "@/lib/db";
import { deleteMessage } from "@/lib/telegram";
import { TextPreview } from "@/components/text-preview";
import { ReportLink } from "@/components/report-link";

type Row = { name: string; mime: string; size: number };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default async function FilePreview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const row = await db.get<Row>("SELECT name, mime, size FROM files WHERE id = ? AND deleted_at IS NULL", id);
  if (!row) notFound();

  // Sweep: mark expired files deleted so they drop out of listings and
  // remove the Telegram blob.
  const expired = await db.get<{ tg_chat_id: string; tg_message_id: number }>(
    "SELECT tg_chat_id, tg_message_id FROM files WHERE id = ? AND expires_at IS NOT NULL AND expires_at < ?",
    id,
    Date.now()
  );
  if (expired) {
    await db.run("UPDATE files SET deleted_at = ? WHERE id = ?", Date.now(), id);
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
        <button
          onClick={() => {
            navigator.clipboard.writeText(window.location.origin + `/raw/${id}/${encodeURIComponent(row.name)}`);
          }}
          style={{
            padding: "8px 16px",
            background: "#eee",
            border: "1px solid #ccc",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          Copy URL
        </button>
        <ReportLink id={id} />
      </div>
    </main>
  );
}
