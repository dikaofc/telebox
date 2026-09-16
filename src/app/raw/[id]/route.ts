import { NextRequest } from "next/server";
import db from "@/lib/db";
import { botFileUrl, getFilePath } from "@/lib/telegram";

export const runtime = "nodejs";

type FileRow = { name: string; mime: string; size: number; tg_file_id: string; expires_at: number | null };

function isExpired(row: FileRow): boolean {
  return row.expires_at !== null && Date.now() > row.expires_at;
}

async function sweepExpired(id: string): Promise<void> {
  await db.run("UPDATE files SET deleted_at = ? WHERE id = ? AND expires_at IS NOT NULL AND expires_at < ?", Date.now(), id, Date.now());
}

async function handleHead(id: string) {
  const row = await db.get<{ size: number; expires_at: number | null }>(
    "SELECT size, expires_at FROM files WHERE id = ? AND deleted_at IS NULL",
    id
  );
  if (!row) return new Response(null, { status: 404 });
  if (row.expires_at !== null && Date.now() > row.expires_at) {
    await sweepExpired(id);
    return new Response(null, { status: 410 });
  }
  return new Response(null, {
    status: 200,
    headers: { "Content-Length": String(row.size), "Accept-Ranges": "bytes" },
  });
}

async function handleGet(req: NextRequest, id: string) {
  const row = await db.get<FileRow>(
    "SELECT name, mime, size, tg_file_id, expires_at FROM files WHERE id = ? AND deleted_at IS NULL",
    id
  );
  if (!row) return new Response("not found", { status: 404 });
  if (isExpired(row)) {
    await sweepExpired(id);
    return new Response("file expired", { status: 410 });
  }

  const upstream = await fetch(botFileUrl(await getFilePath(row.tg_file_id)));
  if (!upstream.ok || !upstream.body) {
    return new Response("upstream error", { status: 502 });
  }

  // SVG can carry scripts — never render inline, always force download.
  const forceDownload = row.mime === "image/svg+xml";
  const dl = forceDownload || req.nextUrl.searchParams.get("dl") === "1";
  const disposition = dl
    ? `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`
    : `inline; filename*=UTF-8''${encodeURIComponent(row.name)}`;

  const cacheControl = row.expires_at
    ? "public, max-age=0, must-revalidate"
    : "public, max-age=31536000, immutable";

  return new Response(upstream.body, {
    headers: {
      "Content-Type": row.mime,
      "Content-Length": String(row.size),
      "Content-Disposition": disposition,
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
    },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleGet(req, (await params).id);
}

export async function HEAD(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleHead((await params).id);
}