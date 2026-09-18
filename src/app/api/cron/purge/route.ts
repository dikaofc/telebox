import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { purgeExpired } from "@/lib/purge";

export const runtime = "nodejs";

function secretMatches(provided: string | null, secret: string): boolean {
  if (provided === null) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Cron target (vercel.json) + manual trigger. Optional CRON_SECRET gate so
 * a public URL can't be used to force work; unset = open (local dev).
 * Accepts `?secret=` or `Authorization: Bearer` (Vercel cron + logs safety).
 * Comparison is timing-safe so the secret can't be read byte-by-byte.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const viaQuery = req.nextUrl.searchParams.get("secret");
    const authHeader = req.headers.get("authorization");
    const viaHeader = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!secretMatches(viaQuery, secret) && !secretMatches(viaHeader, secret)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  try {
    const result = await purgeExpired();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("purge cron failed", e);
    return NextResponse.json({ ok: false, error: "purge failed" }, { status: 500 });
  }
}
