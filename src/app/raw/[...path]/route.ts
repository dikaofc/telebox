import { NextRequest } from "next/server";
import db from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { isExpired, buildRawResponse, type RawRow } from "@/lib/raw-serve";
import { deleteMessage } from "@/lib/telegram";

export const runtime = "nodejs";

// Mark expired files deleted so they stop appearing in listings/stats, and
// remove the Telegram blob. Runs on each access — a real janitor job can
// replace this once there's a cron.
async function sweepExpired(id: string): Promise<void> {
  const row = await db.get<{ tg_chat_id: string; tg_message_id: number }>(
    "SELECT tg_chat_id, tg_message_id FROM files WHERE id = ? AND expires_at IS NOT NULL AND expires_at < ? AND deleted_at IS NULL",
    id,
    Date.now()
  );
  if (row) {
    await db.run("UPDATE files SET deleted_at = ? WHERE id = ?", Date.now(), id);
    void deleteMessage(row.tg_chat_id, row.tg_message_id);
  }
}

type Row = { user_id: number | null } & RawRow;

async function getRow(id: string) {
  return db.get<Row>(
    "SELECT name, mime, size, tg_file_id, expires_at, user_id FROM files WHERE id = ? AND deleted_at IS NULL",
    id
  );
}

// Anonymous uploads (user_id=0) are public share links; account files are
// private to the owner. Unknown id or wrong owner both read as 404.
async function canAccess(rowUserId: number | null): Promise<boolean> {
  if (rowUserId == null || rowUserId === 0) return true;
  const userId = await getSessionUserId();
  return userId === rowUserId;
}

/**
 * GET/HEAD /raw/{id} or /raw/{id}/{name}. The id is canonical; the optional
 * name path segment is cosmetic (contains the filename for nicer links).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const [id, ...rest] = path;
  if (!id) return new Response("not found", { status: 404 });
  const prettyName = rest.length > 0 ? decodeURIComponent(rest.join("/")) : null;

  const row = await getRow(id);
  if (!row || !(await canAccess(row.user_id))) return new Response("not found", { status: 404 });
  if (isExpired(row)) {
    await sweepExpired(id);
    return new Response("file expired", { status: 410 });
  }

  const dl = req.nextUrl.searchParams.get("dl") === "1";
  return buildRawResponse(row, prettyName, dl);
}

export async function HEAD(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const [id] = path;
  if (!id) return new Response(null, { status: 404 });

  const row = await db.get<{ size: number; expires_at: number | null; user_id: number | null }>(
    "SELECT size, expires_at, user_id FROM files WHERE id = ? AND deleted_at IS NULL",
    id
  );
  if (!row || !(await canAccess(row.user_id))) return new Response(null, { status: 404 });
  if (row.expires_at !== null && Date.now() > row.expires_at) {
    await sweepExpired(id);
    return new Response(null, { status: 410 });
  }
  return new Response(null, {
    status: 200,
    headers: { "Content-Length": String(row.size), "Accept-Ranges": "bytes" },
  });
}