import db from "@/lib/db";
import { getFilePath, botFileUrl } from "@/lib/telegram";

export const runtime = "nodejs";

type Row = { avatar_file_id: string | null; avatar_mime: string | null };

const AVATAR_MIME_FALLBACK = "image/jpeg";
const AVATAR_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Public avatar. Streams from the Telegram storage channel; no auth — an
 * avatar is meant to be visible wherever the display name appears. The mime
 * is clamped to the upload-time allowlist so a poisoned row can never serve
 * executable content types.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return new Response("not found", { status: 404 });

  const row = await db.get<Row>("SELECT avatar_file_id, avatar_mime FROM users WHERE id = ?", id);
  if (!row?.avatar_file_id) return new Response("not found", { status: 404 });

  let filePath: string;
  try {
    filePath = await getFilePath(row.avatar_file_id);
  } catch {
    return new Response("upstream error", { status: 502 });
  }
  const upstream = await fetch(botFileUrl(filePath), { signal: AbortSignal.timeout(20000) });
  if (!upstream.ok || !upstream.body) return new Response("upstream error", { status: 502 });

  const mime = row.avatar_mime && AVATAR_MIMES.has(row.avatar_mime) ? row.avatar_mime : AVATAR_MIME_FALLBACK;
  return new Response(upstream.body, {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
