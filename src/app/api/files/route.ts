import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { resolveUserId } from "@/lib/session";
import { rawUrl } from "@/lib/raw-serve";

export const runtime = "nodejs";

// List current user's files
export async function GET(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = (await db.all<{ id: string; name: string; mime: string; size: number; created_at: number; expires_at: number | null }>(
    `SELECT id, name, mime, size, created_at, expires_at
     FROM files WHERE user_id = ? AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 100`,
    userId
  ));

  const origin = new URL(req.url).origin;
  return NextResponse.json({
    files: rows.map((r) => ({
      id: r.id,
      name: r.name,
      mime: r.mime,
      size: r.size,
      created_at: new Date(r.created_at).toISOString(),
      expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : null,
      url: `${origin}/i/${r.id}`,
      direct_url: rawUrl(origin, r.id, r.name),
    })),
  });
}