import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { validateFile } from "@/lib/validation";
import { sendDocument } from "@/lib/telegram";
import { getSessionUser } from "@/lib/session";
import { MAX_AVATAR_BYTES, validateAvatar } from "@/lib/paste";

export const runtime = "nodejs";

/** Upload profile photo. Validated like any file; stored in Telegram. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("avatar");
  if (!(file instanceof File)) return NextResponse.json({ error: "avatar field required" }, { status: 400 });

  // Avatar is image-only on top of the generic file validation.
  if (!validateAvatar(file.type)) {
    return NextResponse.json({ error: "avatar must be a jpeg/png/webp image under 2MB" }, { status: 400 });
  }
  if (file.size > MAX_AVATAR_BYTES) return NextResponse.json({ error: "avatar too large (max 2MB)" }, { status: 400 });

  const buf = new Uint8Array(await file.arrayBuffer());
  const v = validateFile(file.name, file.type || "application/octet-stream", file.size, buf.subarray(0, 512));
  if (!v.valid) return NextResponse.json({ error: `avatar: ${v.error}` }, { status: 415 });

  const sent = await sendDocument(new Blob([buf], { type: file.type }), "avatar");
  await db.run("UPDATE users SET avatar_file_id = ?, avatar_mime = ? WHERE id = ?", sent.fileId, file.type, user.id);

  return NextResponse.json({ ok: true, avatar_url: `/avatar/${user.id}` });
}