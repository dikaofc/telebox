import { getFilePath, botFileUrl } from "@/lib/telegram";

export type RawRow = {
  name: string;
  mime: string;
  size: number;
  tg_file_id: string;
  expires_at: number | null;
};

export function isExpired(row: RawRow): boolean {
  return row.expires_at !== null && Date.now() > row.expires_at;
}

/**
 * Serve a file by id. `prettyName` (optional) comes from /raw/{id}/{name} and
 * is only cosmetic — the id is canonical. Falls back to the stored name.
 */
export async function buildRawResponse(
  row: RawRow | undefined,
  prettyName: string | null,
  dl: boolean
): Promise<Response> {
  if (!row) return new Response("not found", { status: 404 });

  const upstream = await fetch(botFileUrl(await getFilePath(row.tg_file_id)));
  if (!upstream.ok || !upstream.body) {
    return new Response("upstream error", { status: 502 });
  }

  // SVG can carry scripts — never render inline, always force download.
  const forceDownload = row.mime === "image/svg+xml";
  const fileName = prettyName ?? row.name;
  const disposition = (dl || forceDownload)
    ? `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
    : `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`;

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

export function rawUrl(origin: string, id: string, name: string): string {
  return `${origin}/raw/${id}/${encodeURIComponent(name)}`;
}