import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { rawUrl } from "@/lib/raw-serve";
import { deleteStoredBlobs } from "@/lib/file-storage";
import { resolveUserId } from "@/lib/session";

export const runtime = "nodejs";

type Row = {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  user_id: number;
  created_at: number;
};

// Get single file info. Public files (user_id=0, anonymous uploads) are
// open share links; account files are private to their owner.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const row = await db.get<Row>(
    "SELECT id, name, mime, size, sha256, user_id, created_at FROM files WHERE id = ? AND deleted_at IS NULL",
    id
  );
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const userId = await resolveUserId(req);
  if (row.user_id !== 0 && userId !== row.user_id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const origin = new URL(req.url).origin;
  return NextResponse.json({
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    sha256: row.sha256,
    created_at: new Date(row.created_at).toISOString(),
    url: `${origin}/i/${row.id}`,
    direct_url: rawUrl(origin, row.id, row.name),
  });
}

// Soft-delete
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const row = await db.get<{ user_id: number; tg_chat_id: string; tg_message_id: number; storage_kind: string }>(
    "SELECT user_id, tg_chat_id, tg_message_id, storage_kind FROM files WHERE id = ? AND deleted_at IS NULL",
    id
  );
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const userId = await resolveUserId(req);
  // 404 for wrong owner too — same response as missing, no existence oracle.
  if (!userId || userId !== row.user_id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db.run("UPDATE files SET deleted_at = ? WHERE id = ?", Date.now(), id);
  await db.run("DELETE FROM shares WHERE file_id = ?", id);
  // Remove the blob from Telegram too — the row is the app's record, the
  // message is the storage. Await so dev/test can confirm; Vercel keeps the
  // function alive meanwhile.
  await deleteStoredBlobs(id, { chatId: row.tg_chat_id, messageId: row.tg_message_id }, row.storage_kind);
  return NextResponse.json({ ok: true });
}