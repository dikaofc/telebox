import { NextRequest } from "next/server";
import db from "@/lib/db";
import { deleteStoredBlobs } from "@/lib/file-storage";
import { isExpired, buildRawResponse, type RawRow } from "@/lib/raw-serve";

export const runtime = "nodejs";

/**
 * Share link: /s/{token}. Serves bytes without the owner gate — the token
 * itself is the capability. Honors file soft-delete, file expiry, and the
 * share's own expiry. Revoked or missing token reads as 404, never 403.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const share = await db.get<{ file_id: string; expires_at: number | null }>(
    "SELECT file_id, expires_at FROM shares WHERE token = ?",
    token
  );
  if (!share) return new Response("not found", { status: 404 });
  if (share.expires_at !== null && Date.now() > share.expires_at) {
    await db.run("DELETE FROM shares WHERE token = ?", token);
    return new Response("not found", { status: 404 });
  }

  const row = await db.get<RawRow & { user_id: number }>(
    "SELECT id, name, mime, size, tg_file_id, storage_kind, expires_at, user_id FROM files WHERE id = ? AND deleted_at IS NULL",
    share.file_id
  );
  if (!row) return new Response("not found", { status: 404 });
  if (isExpired(row)) {
    // Mirror the raw route: purge from Telegram, drop the row and its shares.
    const tg = await db.get<{ tg_chat_id: string; tg_message_id: number; storage_kind: string }>(
      "SELECT tg_chat_id, tg_message_id, storage_kind FROM files WHERE id = ?",
      share.file_id
    );
    await db.run("UPDATE files SET deleted_at = ? WHERE id = ?", Date.now(), share.file_id);
    await db.run("DELETE FROM shares WHERE file_id = ?", share.file_id);
    if (tg) void deleteStoredBlobs(share.file_id, { chatId: tg.tg_chat_id, messageId: tg.tg_message_id }, tg.storage_kind);
    return new Response("file expired", { status: 410 });
  }

  const dl = req.nextUrl.searchParams.get("dl") === "1";
  return buildRawResponse(row, null, dl, req.headers.get("range"));
}
