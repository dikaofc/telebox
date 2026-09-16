import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { deleteMessage } from "@/lib/telegram";
import { isAdmin } from "@/lib/session";

export const runtime = "nodejs";

const MAX_REASON = 500;

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "unknown";
  const rl = await checkRateLimit(`report:${ip}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }

  const body = await req.json().catch(() => null);
  const fileId = String(body?.id ?? "").trim();
  const reason = String(body?.reason ?? "").trim().slice(0, MAX_REASON);

  if (!fileId) return NextResponse.json({ error: "missing file id" }, { status: 400 });
  if (!reason) return NextResponse.json({ error: "missing reason" }, { status: 400 });

  const file = await db.get("SELECT id FROM files WHERE id = ? AND deleted_at IS NULL", fileId);
  if (!file) return NextResponse.json({ error: "file not found" }, { status: 404 });

  await db.run("INSERT INTO reports (file_id, reason, created_at) VALUES (?, ?, ?)", fileId, reason, Date.now());

  return NextResponse.json({ ok: true });
}

/** Admin-only. List open reports with file details, newest first. */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const rows = (await db.all<{ id: number; file_id: string; reason: string; created_at: number; reviewed: number; name: string | null; mime: string | null; size: number | null }>(
    `SELECT r.id, r.file_id, r.reason, r.created_at, r.reviewed,
            f.name, f.mime, f.size
     FROM reports r LEFT JOIN files f ON f.id = r.file_id
     WHERE r.reviewed = 0
     ORDER BY r.created_at DESC LIMIT 100`
  ));

  return NextResponse.json({ reports: rows });
}

/** Admin-only. Mark a report reviewed and soft-delete the reported file. */
export async function DELETE(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const reportId = Number(body?.id);
  if (!reportId) return NextResponse.json({ error: "missing report id" }, { status: 400 });

  const report = await db.get<{ id: number; file_id: string }>("SELECT id, file_id FROM reports WHERE id = ?", reportId);
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });

  const file = await db.get<{ tg_chat_id: string; tg_message_id: number }>(
    "SELECT tg_chat_id, tg_message_id FROM files WHERE id = ? AND deleted_at IS NULL",
    report.file_id
  );
  if (file) {
    await db.run("UPDATE files SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL", Date.now(), report.file_id);
    void deleteMessage(file.tg_chat_id, file.tg_message_id);
  }
  await db.run("UPDATE reports SET reviewed = 1 WHERE id = ?", reportId);

  return NextResponse.json({ ok: true });
}