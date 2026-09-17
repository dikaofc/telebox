import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import db from "@/lib/db";
import { newId } from "@/lib/id";
import { sendDocument } from "@/lib/telegram";
import { validateFile } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveUserId } from "@/lib/session";
import { rawUrl } from "@/lib/raw-serve";
import { purgeExpired } from "@/lib/purge";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 50 * 1024 * 1024; // Vercel hobby 4.5MB hard limit; streaming not possible, 413 will still happen on large files
const MIN_TTL = 60; // seconds
const MAX_TTL = 30 * 24 * 60 * 60; // 30 days

// Self-heal: ~1 in 20 uploads runs the janitor, so expiry stays real even
// without a cron reachable. Bounded and cheap; cron remains the guarantee.
function maybePurge(): void {
  if (Math.random() < 0.05) void purgeExpired();
}

function parseTtl(raw: string | null): number | null {
  if (!raw) return null;
  const s = Number(raw);
  if (!Number.isFinite(s)) return null;
  return Math.min(MAX_TTL, Math.max(MIN_TTL, Math.floor(s)));
}

async function handleOneFile(file: File, userId: number, reqUrl: string, ttl: number | null) {
  if (file.size > MAX_BYTES) return { error: `${file.name}: too large`, status: 413 as const };
  const buf = new Uint8Array(await file.arrayBuffer());
  const v = validateFile(file.name, file.type || "application/octet-stream", file.size, buf.subarray(0, 512));
  if (!v.valid) return { error: `${file.name}: ${v.error}`, status: 415 as const };
  const sha256 = createHash("sha256").update(buf).digest("hex");

  // Dedup only within the same owner: account files are private, so a
  // second user uploading identical bytes must not receive the first user's
  // link. Anonymous (user_id=0) is one shared public pool.
  const existing = await db.get<{ id: string }>(
    "SELECT id FROM files WHERE sha256 = ? AND user_id = ? AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)",
    sha256,
    userId,
    Date.now()
  );
  if (existing) {
    return { id: existing.id, url: rawUrl(new URL(reqUrl).origin, existing.id, file.name || existing.id), dedup: true };
  }

  const id = newId();
  const name = file.name || id;
  const mime = file.type || "application/octet-stream";
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
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "unknown";
  const rl = await checkRateLimit(`upload:${ip}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }

  const userId = await resolveUserId(req);
  const form = await req.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "no file field" }, { status: 400 });
  }
  const ttl = parseTtl(form.get("ttl") as string | null);

  if (files.length === 1) {
    const r = await handleOneFile(files[0], userId, req.url, ttl);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json(r);
  }

  const results = [];
  for (const f of files) {
    const r = await handleOneFile(f, userId, req.url, ttl);
    results.push(r);
  }
  return NextResponse.json({ files: results });
}