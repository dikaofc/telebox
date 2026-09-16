import { NextRequest, NextResponse } from "next/server";
import { purgeExpired } from "@/lib/purge";

export const runtime = "nodejs";

/**
 * Cron target (vercel.json) + manual trigger. Optional CRON_SECRET gate so
 * a public URL can't be used to force work; unset = open (local dev).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.nextUrl.searchParams.get("secret") !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await purgeExpired();
  return NextResponse.json({ ok: true, ...result });
}