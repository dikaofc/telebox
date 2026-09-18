import db from "./db.ts";
import { deleteStoredBlobs, cleanupAbandonedUpload } from "./file-storage.ts";
import { UPLOAD_SESSION_MAX_AGE_MS } from "./multipart.ts";

export const DELETED_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // rows stay 7d after soft-delete
const MAX_PURGE = 50; // bounded per run — serverless-friendly

type Blob = { id: string; tg_chat_id: string; tg_message_id: number; storage_kind: string };

async function purgeBlob(row: Blob): Promise<void> {
  await db.run("DELETE FROM shares WHERE file_id = ?", row.id);
  await db.run("DELETE FROM files WHERE id = ?", row.id);
  await deleteStoredBlobs(row.id, { chatId: row.tg_chat_id, messageId: row.tg_message_id }, row.storage_kind);
}

/**
 * Guaranteed janitor for expired/deleted blobs. Lazy sweep only fires on
 * access; this makes expiry real even for never-requested files.
 *
 * Three passes, bounded:
 *  1. expired-but-not-deleted rows: metadata + Telegram blob removed
 *  2. soft-deleted rows past retention: row dropped (blob already gone)
 *  3. abandoned multipart uploads (stale sessions + orphan parts): Telegram
 *     part messages and staging rows removed so crashed uploads can't leak
 * Runs on cron and probabilistically from routes (see cron route + upload).
 */
export async function purgeExpired(now = Date.now()): Promise<{ expired: number; cleaned: number; uploads: number }> {
  const expired = await db.all<Blob>(
    "SELECT id, tg_chat_id, tg_message_id, storage_kind FROM files WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at < ? LIMIT ?",
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
    "SELECT id, tg_chat_id, tg_message_id, storage_kind FROM files WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT ?",
    now - DELETED_ROW_RETENTION_MS,
    MAX_PURGE
  );
  for (const row of retained) {
    await purgeBlob(row); // blob already gone on delete; row cleanup only
  }

  // Abandoned multipart uploads: client vanished mid-upload (or a part upload
  // crashed between the Telegram send and the row insert). Only sessions older
  // than the max age qualify, so in-flight uploads are never touched.
  let uploads = 0;
  const stale = await db.all<{ id: string }>(
    "SELECT id FROM upload_sessions WHERE created_at < ? LIMIT ?",
    now - UPLOAD_SESSION_MAX_AGE_MS,
    MAX_PURGE
  );
  for (const s of stale) {
    try {
      await cleanupAbandonedUpload(s.id);
      uploads++;
    } catch {
      // Next run retries; staging rows keep the next attempt informed.
    }
  }
  const orphans = await db.all<{ file_id: string }>(
    `SELECT DISTINCT file_id FROM file_parts
     WHERE file_id NOT IN (SELECT id FROM files)
       AND file_id NOT IN (SELECT id FROM upload_sessions)
     LIMIT ?`,
    MAX_PURGE
  );
  for (const o of orphans) {
    try {
      await cleanupAbandonedUpload(o.file_id);
      uploads++;
    } catch {
      // Next run retries.
    }
  }

  return { expired: expired.length, cleaned: retained.length, uploads };
}