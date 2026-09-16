import db from "@/lib/db";
import { getFilePath, botFileUrl } from "@/lib/telegram";

export const runtime = "nodejs";

type Row = { avatar_file_id: string | null; avatar_mime: string | null };

/**
 * Public avatar. Streams from the Telegram storage channel; no auth — an
 * avatar is meant to be visible wherever the display name appears.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return new Response("not found", { status: 404 });

  const row = await db.get<Row>("SELECT avatar_file_id, avatar_mime FROM users WHERE id = ?", id);
  if (!row?.avatar_file_id) return new Response("not found", { status: 404 });

  const upstream = await fetch(botFileUrl(await getFilePath(row.avatar_file_id)), { signal: AbortSignal.timeout(20000) });
  if (!upstream.ok || !upstream.body) return new Response("upstream error", { status: 502 });

  return new Response(upstream.body, {
    headers: {
      "Content-Type": row.avatar_mime ?? "image/jpeg",
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}