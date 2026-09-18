import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";

const NAME_MAX = 60;
const NAME_RE = /^[\p{L}\p{N} _.'-]*$/u; // letters/numbers/space/basic punctuation

/** Current profile: name, email, avatar URL, join date. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatar_url: user.avatar_file_id ? `/avatar/${user.id}` : null,
  });
}

/** Update display name. */
export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "").trim().slice(0, NAME_MAX);
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!NAME_RE.test(name)) return NextResponse.json({ error: "name contains unsupported characters" }, { status: 400 });

  await db.run("UPDATE users SET name = ? WHERE id = ?", name, user.id);
  return NextResponse.json({ ok: true, name });
}
