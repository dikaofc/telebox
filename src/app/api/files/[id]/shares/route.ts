import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { newId, newToken } from "@/lib/id";
import { resolveUserId } from "@/lib/session";
import { parseShareTtl } from "@/lib/share";

export const runtime = "nodejs";

type ShareRow = { id: string; token: string; created_at: number; expires_at: number | null };

async function ownedFile(req: NextRequest, fileId: string) {
  const row = await db.get<{ user_id: number }>("SELECT user_id FROM files WHERE id = ? AND deleted_at IS NULL", fileId);
  if (!row) return null;
  const userId = await resolveUserId(req);
  if (!userId || userId !== row.user_id) return null;
  return row;
}

/** List active share links for one file. Owner only. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await ownedFile(req, id))) return NextResponse.json({ error: "not found" }, { status: 404 });

  const rows = await db.all<ShareRow>(
    "SELECT id, token, created_at, expires_at FROM shares WHERE file_id = ? ORDER BY created_at DESC",
    id
  );

  const origin = new URL(req.url).origin;
  return NextResponse.json({
    shares: rows.map((s) => ({
      id: s.id,
      url: `${origin}/s/${s.token}`,
      created_at: new Date(s.created_at).toISOString(),
      expires_at: s.expires_at ? new Date(s.expires_at).toISOString() : null,
    })),
  });
}

/** Create a share link. Owner only; optional `ttl` seconds for expiry. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await ownedFile(req, id))) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const ttl = parseShareTtl(body?.ttl);
  const shareId = newId();
  const token = newToken();
  const createdAt = Date.now();
  const expiresAt = ttl ? createdAt + ttl * 1000 : null;

  await db.run(
    "INSERT INTO shares (id, file_id, token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    shareId, id, token, createdAt, expiresAt
  );

  const origin = new URL(req.url).origin;
  return NextResponse.json(
    { id: shareId, url: `${origin}/s/${token}`, expires_at: expiresAt ? new Date(expiresAt).toISOString() : null },
    { status: 201 }
  );
}

/** Revoke a share link. Owner only. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await ownedFile(req, id))) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const shareId = String(body?.id ?? "");
  if (!shareId) return NextResponse.json({ error: "missing share id" }, { status: 400 });

  await db.run("DELETE FROM shares WHERE id = ? AND file_id = ?", shareId, id);
  return NextResponse.json({ ok: true });
}