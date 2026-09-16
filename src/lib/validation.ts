const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
  "application/zip",
  "application/x-7z-compressed",
  "application/x-tar",
  "application/gzip",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
]);

const EXTENSION_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".zip": "application/zip",
  ".7z": "application/x-7z-compressed",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

// Magic-byte signatures: [offset, bytes]. Checked against the claimed MIME.
// Text types (txt/csv/json/svg) skip binary checks — content is not executable
// on its own, and SVG is always served as attachment (see raw route).
const MAGIC: Record<string, [number, number[]][]> = {
  "image/png": [[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]],
  "image/jpeg": [[0, [0xff, 0xd8, 0xff]]],
  "image/gif": [[0, [0x47, 0x49, 0x46, 0x38]]], // GIF8
  "image/webp": [[0, [0x52, 0x49, 0x46, 0x46]], [8, [0x57, 0x45, 0x42, 0x50]]], // RIFF....WEBP
  "image/avif": [[4, [0x66, 0x74, 0x79, 0x70]]], // ....ftyp
  "application/pdf": [[0, [0x25, 0x50, 0x44, 0x46]]], // %PDF
  "application/zip": [[0, [0x50, 0x4b, 0x03, 0x04]]], // PK..
  "application/x-7z-compressed": [[0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]]],
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

export function validateFile(
  filename: string,
  mime: string,
  size: number,
  head?: Uint8Array
): { valid: boolean; error?: string } {
  if (size === 0) return { valid: false, error: "empty file" };

  const ext = "." + filename.split(".").pop()?.toLowerCase();
  const expectedMime = EXTENSION_MAP[ext];

  if (!ALLOWED_MIME_TYPES.has(mime)) {
    return { valid: false, error: `unsupported mime type: ${mime}` };
  }

  if (expectedMime && expectedMime !== mime) {
    return { valid: false, error: `extension ${ext} does not match mime ${mime}` };
  }

  if (head && !matchesMagic(mime, head)) {
    return { valid: false, error: `content does not match mime ${mime}` };
  }

  return { valid: true };
}