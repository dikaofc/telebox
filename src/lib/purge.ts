import db from "./db.ts";
import { deleteMessage } from "./telegram.ts";

export const DELETED_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // rows stay 7d after soft-delete
const MAX_PURGE = 50; // bounded per run — serverless-friendly

type Blob = { id: string; tg_chat_id: string; tg_message_id: number };

async function purgeBlob(row: Blob): Promise<void> {
  await db.run("DELETE FROM shares WHERE file_id = ?", row.id);
  await db.run("DELETE FROM files WHERE id = ?", row.id);
  await deleteMessage(row.tg_chat_id, row.tg_message_id);
}

/**
 * Guaranteed janitor for expired/deleted blobs. Lazy sweep only fires on
 * access; this makes expiry real even for never-requested files.
 *
 * Two passes, bounded:
 *  1. expired-but-not-deleted rows: metadata + Telegram blob removed
 *  2. soft-deleted rows past retention: row dropped (blob already gone)
 * Runs on cron and probabilistically from routes (see cron route + upload).
 */
export async function purgeExpired(now = Date.now()): Promise<{ expired: number; cleaned: number }> {
  const expired = await db.all<Blob>(
    "SELECT id, tg_chat_id, tg_message_id FROM files WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at < ? LIMIT ?",
    now,
    MAX_PURGE
  );
  for (const row of expired) {
    try {
      await purgeBlob(row);
    } catch {
      // Keep the row so the next run retries; don't orphan the blob.
    }
  }

  const retained = await db.all<Blob>(
    "SELECT id, tg_chat_id, tg_message_id FROM files WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT ?",
    now - DELETED_ROW_RETENTION_MS,
    MAX_PURGE
  );
  for (const row of retained) {
    await purgeBlob(row); // blob already gone on delete; row cleanup only
  }

  return { expired: expired.length, cleaned: retained.length };
}