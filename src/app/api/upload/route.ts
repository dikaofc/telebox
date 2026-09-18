import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import db from "@/lib/db";
import { newId } from "@/lib/id";
import { deleteMessage, sendDocument } from "@/lib/telegram";
import { validateFile, validateFileMeta, detectMime } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIp, resolveUserId } from "@/lib/session";
import { rawUrl } from "@/lib/raw-serve";
import { purgeExpired } from "@/lib/purge";
import { cleanupAbandonedUpload } from "@/lib/file-storage";
import {
  CHUNK_BYTES,
  MAX_SINGLE_FILE_BYTES,
  MAX_UPLOAD_BYTES,
  expectedPartSize,
  isSessionStale,
  validateInitMeta,
} from "@/lib/multipart";
import { hashStoredParts } from "@/lib/raw-serve";

export const runtime = "nodejs";
export const maxDuration = 60;

// Small direct uploads go through this handler in one request. Larger files
// use the chunked protocol below (init → 3 MiB parts → complete) so every
// request stays under the platform's 4.5 MB body cap. Telegram caps a single
// stored document at 50 MB (the chunked ceiling); single-blob files are
// capped at 20 MB because Telegram's getFile download API cannot serve
// anything larger.
const MAX_BYTES = MAX_UPLOAD_BYTES;
const MIN_TTL = 60; // seconds
const MAX_TTL = 30 * 24 * 60 * 60; // 30 days

// Self-heal: ~1 in 20 uploads runs the janitor, so expiry stays real even
// without a cron reachable. Bounded and cheap; cron remains the guarantee.
function maybePurge(): void {
  if (Math.random() < 0.05) void purgeExpired().catch(() => {});
}

function parseTtl(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") return null; // FormData File object, not a TTL
  if (raw === "") return null;
  const s = Number(raw);
  if (!Number.isFinite(s)) return null;
  return Math.min(MAX_TTL, Math.max(MIN_TTL, Math.floor(s)));
}

function invalid(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type UploadSession = {
  id: string; user_id: number; name: string; mime: string; size: number;
  sha256: string; total_parts: number; expires_at: number | null; created_at: number;
};

async function initUpload(req: NextRequest, userId: number, body: Record<string, unknown> | null) {
  const meta = validateInitMeta({ name: body?.name, mime: body?.mime, size: body?.size, sha256: body?.sha256 });
  if (!meta.ok) return invalid("invalid upload metadata");
  const { name, mime, size, sha256 } = meta.value;

  // Size sanity up front so a broken upload fails before any chunk (and any
  // Telegram message) is wasted. All types are accepted; unsafe types are
  // neutralized at serving time (forced attachment, see raw-serve.ts). Magic
  // bytes are checked on part 0 arrival; the full hash is verified against
  // stored bytes at complete.
  const allowed = validateFileMeta(name, mime, size);
  if (!allowed.valid) return invalid(`file: ${allowed.error}`, 415);

  const ttl = parseTtl(body?.ttl);

  // Already have these exact bytes for this owner? Skip the whole upload.
  const dupe = await db.get<{ id: string; name: string; size: number; mime: string }>(
    "SELECT id, name, size, mime FROM files WHERE sha256 = ? AND user_id = ? AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)",
    sha256,
    userId,
    Date.now()
  );
  if (dupe) {
    return NextResponse.json({
      id: dupe.id, name: dupe.name, size: dupe.size, mime: dupe.mime,
      url: rawUrl(new URL(req.url).origin, dupe.id, dupe.name), dedup: true,
    });
  }

  const id = newId(24);
  await db.run(
    `INSERT INTO upload_sessions (id, user_id, name, mime, size, sha256, total_parts, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, userId, name, mime, size, sha256, Math.ceil(size / CHUNK_BYTES), ttl ? Date.now() + ttl * 1000 : null, Date.now()
  );
  return NextResponse.json({ uploadId: id, chunkSize: CHUNK_BYTES, maxBytes: MAX_BYTES });
}

async function uploadChunk(req: NextRequest, userId: number) {
  const form = await req.formData().catch(() => null);
  if (!form) return invalid("invalid upload chunk");
  const uploadId = form.get("uploadId");
  const partIndex = Number(form.get("partIndex"));
  const chunk = form.get("chunk");
  if (typeof uploadId !== "string" || !Number.isSafeInteger(partIndex) || !(chunk instanceof File)) return invalid("invalid upload chunk");

  const session = await db.get<UploadSession>(
    "SELECT id, user_id, name, mime, size, sha256, total_parts, expires_at, created_at FROM upload_sessions WHERE id = ?",
    uploadId
  );
  if (!session || session.user_id !== userId) return invalid("upload not found", 404);
  if (isSessionStale(session.created_at)) {
    await cleanupAbandonedUpload(uploadId);
    return invalid("upload session expired", 410);
  }
  if (partIndex < 0 || partIndex >= session.total_parts || chunk.size === 0 || chunk.size > CHUNK_BYTES) return invalid("invalid upload chunk");
  // Non-final parts must be exactly full: a short middle part would silently
  // shift every later byte. The final part carries the remainder.
  if (chunk.size !== expectedPartSize(session.size, partIndex)) return invalid("invalid upload chunk");

  const bytes = new Uint8Array(await chunk.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  const existing = await db.get<{ size: number }>("SELECT size FROM file_parts WHERE file_id = ? AND part_index = ?", uploadId, partIndex);
  if (existing) {
    if (existing.size !== chunk.size) return invalid("chunk conflict", 409);
    return NextResponse.json({ ok: true, partIndex, alreadyUploaded: true });
  }

  if (partIndex === 0) {
    const v = validateFile(session.name, session.mime, session.size, bytes.subarray(0, 512));
    if (!v.valid) return invalid(`file: ${v.error}`, 415);
  }

  const sent = await sendDocument(new Blob([bytes], { type: "application/octet-stream" }), `${uploadId}.${partIndex}.part`).catch((e: unknown) => {
    throw e instanceof Error ? e : new Error("sendDocument failed");
  });
  try {
    await db.run(
      `INSERT INTO file_parts (file_id, part_index, size, tg_chat_id, tg_message_id, tg_file_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      uploadId, partIndex, chunk.size, String(sent.chatId), sent.messageId, sent.fileId
    );
  } catch (error) {
    await deleteMessage(String(sent.chatId), sent.messageId);
    throw error;
  }
  return NextResponse.json({ ok: true, partIndex, hash });
}

async function completeUpload(req: NextRequest, userId: number, reqUrl: string, body: Record<string, unknown> | null) {
  const uploadId = typeof body?.uploadId === "string" ? body.uploadId : "";

  // Idempotent retry: a first attempt may have succeeded while its response
  // was lost. The finished file keeps the upload id, so answer from it.
  const finished = await db.get<{ id: string; user_id: number; name: string; size: number; mime: string }>(
    "SELECT id, user_id, name, size, mime FROM files WHERE id = ? AND deleted_at IS NULL",
    uploadId
  );
  if (finished) {
    if (finished.user_id !== userId) return invalid("upload not found", 404);
    return NextResponse.json({
      id: finished.id, name: finished.name, size: finished.size, mime: finished.mime,
      url: rawUrl(new URL(reqUrl).origin, finished.id, finished.name),
    });
  }

  const session = await db.get<UploadSession>(
    "SELECT id, user_id, name, mime, size, sha256, total_parts, expires_at, created_at FROM upload_sessions WHERE id = ?",
    uploadId
  );
  if (!session || session.user_id !== userId) return invalid("upload not found", 404);
  if (isSessionStale(session.created_at)) {
    await cleanupAbandonedUpload(uploadId);
    return invalid("upload session expired", 410);
  }

  const parts = await db.all<{ part_index: number; size: number; tg_chat_id: string; tg_message_id: number; tg_file_id: string }>(
    "SELECT part_index, size, tg_chat_id, tg_message_id, tg_file_id FROM file_parts WHERE file_id = ? ORDER BY part_index ASC",
    uploadId
  );
  const complete = parts.length === session.total_parts && parts.every((part, index) => part.part_index === index);
  const size = parts.reduce((sum, part) => sum + part.size, 0);
  if (!complete || size !== session.size) return invalid("upload is incomplete", 409);

  // The sha256 arrived as a client claim at init. Verify it against the bytes
  // actually stored before trusting it for dedup and metadata. A fetch failure
  // here is retryable (staging is kept); a mismatch is deterministic (staging
  // is dropped so it can't leak).
  let actual: Buffer;
  try {
    actual = await hashStoredParts(parts);
  } catch {
    return invalid("could not verify upload, retry completion", 502);
  }
  if (!timingSafeEqHex(actual.toString("hex"), session.sha256)) {
    await cleanupAbandonedUpload(uploadId);
    return invalid("upload corrupted, please upload again", 422);
  }

  const existing = await db.get<{ id: string; name: string; size: number; mime: string }>(
    "SELECT id, name, size, mime FROM files WHERE sha256 = ? AND user_id = ? AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)",
    session.sha256, userId, Date.now()
  );
  if (existing) {
    for (const part of parts) await deleteMessage(part.tg_chat_id, part.tg_message_id);
    await db.run("DELETE FROM file_parts WHERE file_id = ?", uploadId);
    await db.run("DELETE FROM upload_sessions WHERE id = ?", uploadId);
    return NextResponse.json({ id: existing.id, name: existing.name, size: existing.size, mime: existing.mime, url: rawUrl(new URL(reqUrl).origin, existing.id, existing.name), dedup: true });
  }

  const first = parts[0];
  try {
    await db.run(
      `INSERT INTO files (id, user_id, name, mime, size, sha256, tg_chat_id, tg_message_id, tg_file_id, storage_kind, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'parts', ?, ?)`,
      uploadId, userId, session.name, session.mime, session.size, session.sha256, first.tg_chat_id, first.tg_message_id, first.tg_file_id, Date.now(), session.expires_at
    );
  } catch (error) {
    // Two concurrent complete calls can both pass the "not finished" check and
    // race on the files PK. The winner inserted the row; the loser reads it
    // back and answers idempotently instead of throwing a 500.
    const winner = await db.get<{ user_id: number; name: string; size: number; mime: string }>(
      "SELECT user_id, name, size, mime FROM files WHERE id = ? AND deleted_at IS NULL",
      uploadId
    );
    if (winner && winner.user_id === userId) {
      return NextResponse.json({
        id: uploadId, name: winner.name, size: winner.size, mime: winner.mime,
        url: rawUrl(new URL(reqUrl).origin, uploadId, winner.name),
      });
    }
    throw error;
  }
  await db.run("DELETE FROM upload_sessions WHERE id = ?", uploadId);
  return NextResponse.json({ id: uploadId, name: session.name, size: session.size, mime: session.mime, url: rawUrl(new URL(reqUrl).origin, uploadId, session.name) });
}

function timingSafeEqHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

type OneFileResult =
  | { id: string; name: string; size: number; mime: string; url: string; dedup?: boolean }
  | { error: string; status: number };

async function handleOneFile(file: File, userId: number, reqUrl: string, ttl: number | null): Promise<OneFileResult> {
  if (file.size > MAX_SINGLE_FILE_BYTES) {
    return { error: `${file.name}: too large for direct upload (max 20 MB — the API client chunks automatically)`, status: 413 as const };
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  const claimed = file.type || "application/octet-stream";
  // Empty files are the only hard rejection. When the browser sends no useful
  // mime, sniff the real type from the magic bytes so stored metadata (and
  // serving behavior) reflect the actual content.
  let mime = claimed;
  if (mime === "application/octet-stream") {
    mime = detectMime(buf.subarray(0, 512)) ?? mime;
  }
  const v = validateFile(file.name, mime, file.size);
  if (!v.valid) return { error: `${file.name}: ${v.error}`, status: 415 as const };
  const sha256 = createHash("sha256").update(buf).digest("hex");

  // Dedup only within the same owner: account files are private, so a
  // second user uploading identical bytes must not receive the first user's
  // link. Anonymous (user_id=0) is one shared public pool.
  const existing = await db.get<{ id: string; name: string; size: number; mime: string }>(
    "SELECT id, name, size, mime FROM files WHERE sha256 = ? AND user_id = ? AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)",
    sha256,
    userId,
    Date.now()
  );
  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      size: existing.size,
      mime: existing.mime,
      url: rawUrl(new URL(reqUrl).origin, existing.id, existing.name),
      dedup: true,
    };
  }

  const id = newId();
  const name = file.name || id;
  const sent = await sendDocument(new Blob([buf], { type: mime }), name);
  const expiresAt = ttl ? Date.now() + ttl * 1000 : null;

  await db.run(
    `INSERT INTO files (id, user_id, name, mime, size, sha256, tg_chat_id, tg_message_id, tg_file_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, userId, name, mime, file.size, sha256, String(sent.chatId), sent.messageId, sent.fileId, Date.now(), expiresAt
  );

  return { id, name, size: file.size, mime, url: rawUrl(new URL(reqUrl).origin, id, name) };
}

export async function POST(req: NextRequest) {
  maybePurge();
  const rl = await checkRateLimit(`upload:${clientIp(req)}`, 120, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }

  const userId = await resolveUserId(req);
  const contentType = req.headers.get("content-type") ?? "";

  // JSON control messages: init / complete. Anything else that claims to be
  // JSON must not fall through to formData() — that used to throw and answer
  // a 500 HTML page instead of a clean JSON error.
  if (contentType.includes("application/json")) {
    // Parse the JSON body exactly once and pass it down — a Request body is
    // a stream and cannot be read twice (init/complete used to re-read it,
    // get null, and answer "invalid upload metadata").
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (body?.action === "init") return initUpload(req, userId, body);
    if (body?.action === "complete") return completeUpload(req, userId, req.url, body);
    return invalid("unknown action — expected 'init' or 'complete'");
  }

  const form = await req.formData().catch(() => null);
  if (!form) return invalid("expected multipart form data or JSON action");

  if (form.has("uploadId")) return uploadChunk(req, userId);

  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return invalid("no file field");
  }
  const ttl = parseTtl(form.get("ttl"));

  if (files.length === 1) {
    try {
      const r = await handleOneFile(files[0], userId, req.url, ttl);
      if ("error" in r) return invalid(r.error, r.status);
      return NextResponse.json(r);
    } catch (e) {
      console.error("upload failed", e);
      return invalid("upload failed, please retry", 502);
    }
  }

  const results: (Awaited<ReturnType<typeof handleOneFile>>)[] = [];
  let anyFailure = false;
  for (const f of files) {
    try {
      const r = await handleOneFile(f, userId, req.url, ttl);
      results.push(r);
      if ("error" in r) anyFailure = true;
    } catch (e) {
      console.error("upload failed", e);
      results.push({ error: `${f.name}: upload failed`, status: 502 as const });
      anyFailure = true;
    }
  }
  return NextResponse.json({ files: results }, { status: anyFailure ? 207 : 200 });
}
