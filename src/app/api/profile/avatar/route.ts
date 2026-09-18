import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { validateFile } from "@/lib/validation";
import { sendDocument, deleteMessage } from "@/lib/telegram";
import { getSessionUser } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/session";
import { MAX_AVATAR_BYTES, validateAvatar } from "@/lib/paste";

export const runtime = "nodejs";

/** Upload profile photo. Validated like any file; stored in Telegram. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rl = await checkRateLimit(`avatar:${clientIp(req)}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "expected multipart form data" }, { status: 400 });
  const file = form.get("avatar");
  if (!(file instanceof File)) return NextResponse.json({ error: "avatar field required" }, { status: 400 });

  // Avatar is image-only on top of the generic file validation.
  if (!validateAvatar(file.type)) {
    return NextResponse.json({ error: "avatar must be a jpeg/png/webp image under 2MB" }, { status: 400 });
  }
  if (file.size > MAX_AVATAR_BYTES || file.size === 0) {
    return NextResponse.json({ error: "avatar too large (max 2MB)" }, { status: 400 });
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  const v = validateFile(file.name, file.type || "application/octet-stream", file.size);
  if (!v.valid) return NextResponse.json({ error: `avatar: ${v.error}` }, { status: 415 });

  const sent = await sendDocument(new Blob([buf], { type: file.type }), "avatar");
  const prev = await db.get<{ avatar_tg_chat_id: string | null; avatar_tg_message_id: number | null }>(
    "SELECT avatar_tg_chat_id, avatar_tg_message_id FROM users WHERE id = ?",
    user.id
  );
  await db.run(
    "UPDATE users SET avatar_file_id = ?, avatar_mime = ?, avatar_tg_chat_id = ?, avatar_tg_message_id = ? WHERE id = ?",
    sent.fileId, file.type, String(sent.chatId), sent.messageId, user.id
  );
  // Delete the replaced avatar blob only after the new one is durably recorded.
  if (prev?.avatar_tg_chat_id && prev.avatar_tg_message_id) {
    void deleteMessage(prev.avatar_tg_chat_id, prev.avatar_tg_message_id);
  }

  return NextResponse.json({ ok: true, avatar_url: `/avatar/${user.id}` });
}
