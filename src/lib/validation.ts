/**
 * File validation. Policy (v2): ALL file types are accepted — the allowlist
 * era is over. Executables, archives, documents, anything. Two non-negotiable
 * rules remain:
 *
 *  1. Empty files are rejected (nothing to store, breaks size invariants).
 *  2. Unsafe types are never rendered inline: `src/lib/raw-serve.ts` forces
 *     `Content-Disposition: attachment` for active-content mimes (html, js,
 *     svg, wasm, …) so uploaded code can never execute on this origin.
 *
 * The magic-byte table below is kept for detection/tests, not rejection —
 * client `Content-Type` is still never trusted for anything security-relevant.
 */

// Magic-byte signatures: [offset, bytes]. Used to *detect* a file's real type;
// a mismatch with the claimed mime is no longer a rejection.
const MAGIC: Record<string, [number, number[]][]> = {
  "image/png": [[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]],
  "image/jpeg": [[0, [0xff, 0xd8, 0xff]]],
  "image/gif": [[0, [0x47, 0x49, 0x46, 0x38]]], // GIF8
  "image/webp": [[0, [0x52, 0x49, 0x46, 0x46]], [8, [0x57, 0x45, 0x42, 0x50]]], // RIFF....WEBP
  "image/avif": [[4, [0x66, 0x74, 0x79, 0x70]]], // ....ftyp
  "application/pdf": [[0, [0x25, 0x50, 0x44, 0x46]]], // %PDF
  "application/zip": [[0, [0x50, 0x4b, 0x03, 0x04]]], // PK..
  "application/x-7z-compressed": [[0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]]],
  "application/vnd.rar": [[0, [0x52, 0x61, 0x72, 0x21]]], // Rar!
  "application/x-msdownload": [[0, [0x4d, 0x5a]]], // MZ (exe/dll/sys)
  "application/gzip": [[0, [0x1f, 0x8b]]],
  "application/x-tar": [[257, [0x75, 0x73, 0x74, 0x61, 0x72]]], // ustar
  "video/mp4": [[4, [0x66, 0x74, 0x79, 0x70]]], // ....ftyp
  "video/quicktime": [[4, [0x66, 0x74, 0x79, 0x70]]],
  "video/webm": [[0, [0x1a, 0x45, 0xdf, 0xa3]]],
  "audio/mpeg": [[0, [0x49, 0x44, 0x33]]], // ID3 — raw frames (FF Fx) checked below
  "audio/wav": [[0, [0x52, 0x49, 0x46, 0x46]], [8, [0x57, 0x41, 0x56, 0x45]]], // RIFF....WAVE
  "audio/ogg": [[0, [0x4f, 0x67, 0x67, 0x53]]], // OggS
};

export function matchesMagic(mime: string, head: Uint8Array): boolean {
  // MP3 without ID3 tag starts with a frame sync (0xFF, 0xE0 mask)
  if (mime === "audio/mpeg" && head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return true;
  const sigs = MAGIC[mime];
  if (!sigs) return true; // no signature known (text/*, json, svg) — skip
  return sigs.every(([off, bytes]) =>
    head.length >= off + bytes.length && bytes.every((b, i) => head[off + i] === b)
  );
}

/**
 * Best-effort real-type detection from a byte head. Returns null when no
 * known signature matches. Ambiguous signatures (mp4/mov share ftyp) resolve
 * to the first table hit — callers only use this when the client sent no
 * usable mime.
 */
export function detectMime(head: Uint8Array): string | null {
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return "audio/mpeg";
  for (const [mime, sigs] of Object.entries(MAGIC)) {
    if (mime === "video/quicktime") continue; // ftyp already matched as mp4
    if (sigs.every(([off, bytes]) => head.length >= off + bytes.length && bytes.every((b, i) => head[off + i] === b))) {
      return mime;
    }
  }
  return null;
}

/** Size sanity only — every mime/extension is accepted. */
export function validateFileMeta(
  _filename: string,
  _mime: string,
  size: number
): { valid: boolean; error?: string } {
  if (!Number.isSafeInteger(size) || size <= 0) return { valid: false, error: "invalid file size" };
  return { valid: true };
}

export function validateFile(
  filename: string,
  mime: string,
  size: number
): { valid: boolean; error?: string } {
  if (size === 0) return { valid: false, error: "empty file" };
  return validateFileMeta(filename, mime, size);
}
