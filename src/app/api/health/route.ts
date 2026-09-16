import { NextResponse } from "next/server";
import db from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  let dbOk = false;
  try {
    await db.get("SELECT 1");
    dbOk = true;
  } catch {}

  const tgOk = !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_STORAGE_CHAT_ID);

  return NextResponse.json({
    status: dbOk && tgOk ? "ok" : "degraded",
    database: dbOk ? "ok" : "error",
    storage: tgOk ? "configured" : "missing",
  });
}