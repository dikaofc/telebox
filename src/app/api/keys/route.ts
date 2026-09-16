import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import db from "@/lib/db";
import { getSessionUserId } from "@/lib/session";

export const runtime = "nodejs";

type KeyRow = { id: number; name: string; created_at: number; last_used_at: number | null };

// List API keys for current user
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = (await db.all<KeyRow>("SELECT id, name, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC", userId));

  return NextResponse.json({
    keys: rows.map((r) => ({
      id: r.id,
      name: r.name,
      created_at: new Date(r.created_at).toISOString(),
      last_used_at: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
    })),
  });
}

// Create new API key
export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "").slice(0, 100);

  const raw = `tb_${randomBytes(24).toString("base64url")}`;
  const hash = createHash("sha256").update(raw).digest("hex");

  await db.run("INSERT INTO api_keys (user_id, name, key_hash, created_at) VALUES (?, ?, ?, ?)", userId, name, hash, Date.now());
  const row = await db.get<{ id: number }>("SELECT id FROM api_keys WHERE key_hash = ?", hash);
  const keyId = row?.id ?? 0;

  return NextResponse.json({
    id: keyId,
    name,
    key: raw,
  });
}

// Delete API key
export async function DELETE(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const keyId = Number(body?.id);
  if (!keyId) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const row = await db.get("SELECT id FROM api_keys WHERE id = ? AND user_id = ?", keyId, userId);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  await db.run("DELETE FROM api_keys WHERE id = ?", keyId);
  return NextResponse.json({ ok: true });
}