/**
 * Chunked upload protocol (production path for files larger than a single
 * Vercel function request body, 4.5 MB).
 *
 * Every request stays small: init/complete are JSON, each chunk is at most
 * CHUNK_BYTES of multipart bytes. Parts are stored as individual Telegram
 * documents (`file_parts`) and concatenated back in order when serving.
 */

export const CHUNK_BYTES = 3 * 1024 * 1024; // 3 MiB per request, safely under the 4.5 MB platform cap
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // Telegram Bot API sendDocument cap
export const MAX_PARTS = Math.ceil(MAX_UPLOAD_BYTES / CHUNK_BYTES);

/**
 * Telegram Bot API cloud can STORE documents up to 50 MB, but getFile can
 * only DOWNLOAD files up to 20 MB. A single-blob file above this would upload
 * fine yet be un-servable, so direct (non-chunked) uploads are capped here
 * and anything larger must go through the chunked protocol where each part
 * is far below the limit.
 */
export const MAX_SINGLE_FILE_BYTES = 20 * 1024 * 1024;

/** Abandoned sessions (client vanished mid-upload) are janitored after this. */
export const UPLOAD_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Browser text preview fetches the whole body — cap it so huge files don't OOM the tab. */
export const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

export function totalPartsFor(size: number): number {
  return Math.ceil(size / CHUNK_BYTES);
}

/**
 * Exact byte length part `index` must have. Non-final parts are always full;
 * only the last part may be short. Enforced on upload so a short middle part
 * can never silently corrupt the reassembled file.
 */
export function expectedPartSize(size: number, index: number): number {
  const total = totalPartsFor(size);
  if (index < 0 || index >= total) throw new Error("part index out of range");
  return index < total - 1 ? CHUNK_BYTES : size - CHUNK_BYTES * (total - 1);
}

export function isSessionStale(createdAt: number, now = Date.now()): boolean {
  return now - createdAt > UPLOAD_SESSION_MAX_AGE_MS;
}

const SHA256_HEX = /^[a-f0-9]{64}$/i;

export type InitMeta = { name: string; mime: string; size: number; sha256: string };

/**
 * Fail-fast metadata check for init (magic bytes can't be checked yet — no
 * bytes have arrived; part 0 is magic-checked on arrival and the full hash is
 * verified against Telegram-stored bytes at complete).
 */
export function validateInitMeta(input: {
  name: unknown;
  mime: unknown;
  size: unknown;
  sha256: unknown;
}): { ok: true; value: InitMeta } | { ok: false; error: string } {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 255) : "";
  const mime = typeof input.mime === "string" ? input.mime : "";
  const size = Number(input.size);
  const sha256 = typeof input.sha256 === "string" ? input.sha256 : "";
  if (!name) return { ok: false, error: "invalid upload metadata" };
  if (!mime) return { ok: false, error: "invalid upload metadata" };
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "invalid upload metadata" };
  }
  if (totalPartsFor(size) > MAX_PARTS || !SHA256_HEX.test(sha256)) {
    return { ok: false, error: "invalid upload metadata" };
  }
  return { ok: true, value: { name, mime, size, sha256: sha256.toLowerCase() } };
}
