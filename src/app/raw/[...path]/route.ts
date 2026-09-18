import { NextRequest } from "next/server";
import db from "@/lib/db";
import { resolveUserId } from "@/lib/session";
import { isExpired, buildRawResponse, type RawRow } from "@/lib/raw-serve";
import { deleteStoredBlobs } from "@/lib/file-storage";

export const runtime = "nodejs";

// Mark expired files deleted so they stop appearing in listings/stats, and
// remove the Telegram blob. Runs on each access — the cron janitor remains
// the guarantee for never-requested files.
async function sweepExpired(id: string): Promise<void> {
  const row = await db.get<{ tg_chat_id: string; tg_message_id: number; storage_kind: string }>(
    "SELECT tg_chat_id, tg_message_id, storage_kind FROM files WHERE id = ? AND expires_at IS NOT NULL AND expires_at < ? AND deleted_at IS NULL",
    id,
    Date.now()
  );
  if (row) {
    await db.run("UPDATE files SET deleted_at = ? WHERE id = ?", Date.now(), id);
    await db.run("DELETE FROM shares WHERE file_id = ?", id);
    void deleteStoredBlobs(id, { chatId: row.tg_chat_id, messageId: row.tg_message_id }, row.storage_kind);
  }
}

type Row = { user_id: number | null } & RawRow;

async function getRow(id: string) {
  return db.get<Row>(
    "SELECT id, name, mime, size, tg_file_id, storage_kind, expires_at, user_id FROM files WHERE id = ? AND deleted_at IS NULL",
    id
  );
}

// Anonymous uploads (user_id=0) are public share links; account files are
// private to the owner. Unknown id or wrong owner both read as 404.
// Auth is session cookie or API-key bearer (see resolveUserId).
async function canAccess(req: NextRequest, rowUserId: number | null): Promise<boolean> {
  if (rowUserId == null || rowUserId === 0) return true;
  const userId = await resolveUserId(req);
  return userId === rowUserId;
}

/** The name path segment is cosmetic; malformed encoding must not 500. */
function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * GET/HEAD /raw/{id} or /raw/{id}/{name}. The id is canonical; the optional
 * name path segment is cosmetic (contains the filename for nicer links).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const [id, ...rest] = path;
  if (!id) return new Response("not found", { status: 404 });
  const prettyName = rest.length > 0 ? safeDecode(rest.join("/")) : null;

  const row = await getRow(id);
  if (!row || !(await canAccess(req, row.user_id))) return new Response("not found", { status: 404 });
  if (isExpired(row)) {
    await sweepExpired(id);
    return new Response("file expired", { status: 410 });
  }

  const dl = req.nextUrl.searchParams.get("dl") === "1";
  return buildRawResponse(row, prettyName, dl, req.headers.get("range"));
}

export async function HEAD(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const [id] = path;
  if (!id) return new Response(null, { status: 404 });

  const row = await db.get<{ size: number; expires_at: number | null; user_id: number | null }>(
    "SELECT size, expires_at, user_id FROM files WHERE id = ? AND deleted_at IS NULL",
    id
  );
  if (!row || !(await canAccess(req, row.user_id))) return new Response(null, { status: 404 });
  if (row.expires_at !== null && Date.now() > row.expires_at) {
    await sweepExpired(id);
    return new Response(null, { status: 410 });
  }
  return new Response(null, {
    status: 200,
    headers: { "Content-Length": String(row.size), "Accept-Ranges": "bytes" },
  });
}
