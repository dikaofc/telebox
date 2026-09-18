import { getFilePath, botFileUrl } from "@/lib/telegram";
import db from "@/lib/db";

export type RawRow = {
  id?: string;
  name: string;
  mime: string;
  size: number;
  tg_file_id: string;
  storage_kind?: string;
  expires_at: number | null;
};

export function isExpired(row: RawRow): boolean {
  return row.expires_at !== null && Date.now() > row.expires_at;
}

/**
 * Mimes that browsers execute when rendered inline. Always served as
 * `attachment` regardless of the `dl` parameter (or the extension the file
 * was uploaded with).
 */
const UNSAFE_INLINE_MIMES = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/javascript",
  "application/javascript",
  "application/x-javascript",
  "module",
  "image/svg+xml",
  "application/wasm",
  "text/xml",
  "application/xml",
  "application/x-msdownload",
  "application/x-msi",
  "application/x-sh",
  "application/x-httpd-php",
  "text/x-php",
]);

type ByteRange = { start: number; end: number };

/**
 * Parse a single-range Range header ("bytes=a-b", "bytes=a-", "bytes=-n").
 * Returns null when the header is absent or syntactically invalid (caller
 * then serves the whole body with 200). Returns "unsatisfiable" for ranges
 * beyond EOF (caller answers 416). Multi-range requests serve the first
 * range only — correct for every mainstream client.
 */
export function parseRange(header: string | null, size: number): ByteRange | null | "unsatisfiable" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    // suffix form: last N bytes
    const n = Number(m[2]);
    if (!Number.isSafeInteger(n) || n === 0) return null;
    if (size === 0) return "unsatisfiable";
    const start = Math.max(0, size - n);
    return { start, end: size - 1 };
  }
  const start = Number(m[1]);
  if (!Number.isSafeInteger(start)) return null;
  let end = m[2] === "" ? size - 1 : Number(m[2]);
  if (!Number.isSafeInteger(end)) return null;
  end = Math.min(end, size - 1);
  if (start > end) return size === 0 ? "unsatisfiable" : start >= size ? "unsatisfiable" : null;
  if (start >= size) return "unsatisfiable";
  return { start, end };
}

/** Stream the bytes of one stored part between [skip, take) counters. */
function pumpPart(
  controller: ReadableStreamDefaultController<Uint8Array>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  skip: number,
  take: number
): Promise<void> {
  return (async () => {
    let skipped = 0;
    let taken = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let chunk = value;
      if (skipped < skip) {
        if (skipped + chunk.length <= skip) {
          skipped += chunk.length;
          continue;
        }
        chunk = chunk.subarray(skip - skipped);
        skipped = skip;
      }
      if (taken + chunk.length >= take) {
        const last = chunk.subarray(0, take - taken);
        if (last.length > 0) controller.enqueue(last);
        taken = take;
        await reader.cancel().catch(() => {});
        return;
      }
      if (chunk.length > 0) controller.enqueue(chunk);
      taken += chunk.length;
    }
    if (taken < take) throw new Error(`part truncated: got ${taken}, expected ${take}`);
  })();
}

/** Stream stored part bytes through a hasher without buffering the file. */
export async function hashStoredParts(parts: { tg_file_id: string }[]): Promise<Buffer> {
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256");
  for (const part of parts) {
    const res = await fetch(botFileUrl(await getFilePath(part.tg_file_id)), {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok || !res.body) throw new Error(`part verify fetch failed: ${res.status}`);
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
    }
    reader.releaseLock();
  }
  return hash.digest();
}

/**
 * Serve a file by id. `prettyName` (optional) comes from /raw/{id}/{name} and
 * is only cosmetic — the id is canonical. `rangeHeader` enables HTTP Range
 * (video seek, resumable downloads). Falls back to the stored name.
 */
export async function buildRawResponse(
  row: RawRow,
  prettyName: string | null,
  dl: boolean,
  rangeHeader: string | null = null
): Promise<Response> {
  const range = parseRange(rangeHeader, row.size);

  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${row.size}`, "Accept-Ranges": "bytes" },
    });
  }

  let body: ReadableStream<Uint8Array>;

  if (row.storage_kind === "parts") {
    const parts = await db.all<{ part_index: number; size: number; tg_file_id: string }>(
      "SELECT part_index, size, tg_file_id FROM file_parts WHERE file_id = ? ORDER BY part_index ASC",
      row.id ?? row.tg_file_id
    );
    // Gapless 0..n-1 indexes summing to the declared size; anything else is
    // stored-data corruption — fail loudly instead of serving a bad prefix.
    let sum = 0;
    let intact = parts.length > 0;
    for (let i = 0; intact && i < parts.length; i++) {
      if (parts[i].part_index !== i) intact = false;
      sum += parts[i].size;
    }
    if (!intact || sum !== row.size) {
      console.warn(`parts integrity failed for file ${row.id ?? row.tg_file_id}`);
      return new Response("upstream error", { status: 502 });
    }
    // Per-part byte offsets for range slicing.
    const offsets: number[] = [];
    let acc = 0;
    for (const part of parts) {
      offsets.push(acc);
      acc += part.size;
    }
    const start = range ? range.start : 0;
    const end = range ? range.end : row.size - 1;

    body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for (let i = 0; i < parts.length; i++) {
            const offset = offsets[i];
            const partEnd = offset + parts[i].size;
            if (partEnd <= start || offset > end) continue; // part out of range
            const upstream = await fetch(botFileUrl(await getFilePath(parts[i].tg_file_id)), {
              signal: AbortSignal.timeout(60_000),
            });
            if (!upstream.ok || !upstream.body) throw new Error("part fetch failed");
            const reader = upstream.body.getReader();
            try {
              await pumpPart(controller, reader, Math.max(0, start - offset), Math.min(parts[i].size, end - offset + 1));
            } finally {
              reader.releaseLock();
            }
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
  } else {
    // Single blob: forward the Range header upstream so Telegram serves only
    // the requested slice; otherwise stream the whole thing.
    const upstream = await fetch(botFileUrl(await getFilePath(row.tg_file_id)), {
      headers: range ? { Range: `bytes=${range.start}-${range.end}` } : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    if (!upstream.ok || !upstream.body) return new Response("upstream error", { status: 502 });
    body = upstream.body;
  }

  // Active-content types (html, js, svg, wasm, …) can execute when rendered
  // by the browser. Since all file types are accepted, these are always
  // forced to download — they can never render on this origin, which keeps
  // stored-XSS off the site. Previewable media (image/video/audio/text/pdf)
  // stay inline so the preview pages keep working.
  const forceDownload = UNSAFE_INLINE_MIMES.has(row.mime);
  const fileName = prettyName ?? row.name;
  const disposition = (dl || forceDownload)
    ? `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
    : `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`;

  const cacheControl = row.expires_at
    ? "public, max-age=0, must-revalidate"
    : "public, max-age=31536000, immutable";

  if (range) {
    // 206 Partial Content. For single-blob upstreams Telegram answered the
    // range itself, so the slice bounds match what was requested.
    const length = range.end - range.start + 1;
    return new Response(body, {
      status: 206,
      headers: {
        "Content-Type": row.mime,
        "Content-Length": String(length),
        "Content-Range": `bytes ${range.start}-${range.end}/${row.size}`,
        "Content-Disposition": disposition,
        "Cache-Control": cacheControl,
        "X-Content-Type-Options": "nosniff",
        "Accept-Ranges": "bytes",
      },
    });
  }

  return new Response(body, {
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
