import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { getSessionUserId } from "@/lib/session";

export const runtime = "nodejs";

type Stats = {
  total_files: number;
  total_size: number;
  total_users: number;
  total_keys: number;
  deduped_saves: number;
  storage_bytes: number;
};

export async function GET(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const fileStats = (await db.get<{ total_files: number; total_size: number; unique_shas: number }>(
    "SELECT COUNT(*) as total_files, COALESCE(SUM(size), 0) as total_size, COUNT(DISTINCT sha256) as unique_shas FROM files WHERE deleted_at IS NULL"
  )) ?? { total_files: 0, total_size: 0, unique_shas: 0 };

  const totalRows = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM files WHERE deleted_at IS NULL")) ?? { c: 0 };
  const dedupedSaves = totalRows.c - fileStats.unique_shas;

  const userCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM users")) ?? { c: 0 };
  const keyCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM api_keys")) ?? { c: 0 };

  const topFiles = (await db.all<{ name: string; mime: string; size: number }>(
    "SELECT name, mime, size FROM files WHERE deleted_at IS NULL ORDER BY size DESC LIMIT 10"
  ));

  return NextResponse.json({
    total_files: fileStats.total_files,
    total_size: fileStats.total_size,
    total_size_human: formatSize(fileStats.total_size),
    total_users: userCount.c,
    total_keys: keyCount.c,
    deduped_saves: dedupedSaves,
    top_files: topFiles,
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}