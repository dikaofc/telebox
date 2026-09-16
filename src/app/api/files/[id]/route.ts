import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { resolveUserId, getSessionUserId } from "@/lib/session";

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

// Get single file info
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const row = await db.get<Row>(
    "SELECT id, name, mime, size, sha256, user_id, created_at FROM files WHERE id = ? AND deleted_at IS NULL",
    id
  );
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const origin = new URL(req.url).origin;
  return NextResponse.json({
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    sha256: row.sha256,
    created_at: new Date(row.created_at).toISOString(),
    url: `${origin}/i/${row.id}`,
    direct_url: `${origin}/raw/${row.id}`,
  });
}

// Soft-delete
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const row = await db.get<{ user_id: number }>("SELECT user_id FROM files WHERE id = ? AND deleted_at IS NULL", id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const userId = await resolveUserId(req);
  if (!userId || userId !== row.user_id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  await db.run("UPDATE files SET deleted_at = ? WHERE id = ?", Date.now(), id);
  return NextResponse.json({ ok: true });
}