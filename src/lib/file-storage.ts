import db from "./db.ts";
import { deleteMessage } from "./telegram.ts";

/**
 * Remove every Telegram message backing a file: all `file_parts` rows plus
 * the primary message on the files row. The primary is always deleted too —
 * for parts-files it duplicates parts[0], which makes cleanup leak-proof
 * even if the parts rows are already gone. deleteMessage is idempotent and
 * best-effort, so double-deletes are harmless.
 */
export async function deleteStoredBlobs(
  fileId: string,
  primary: { chatId: string; messageId: number },
  storageKind: string = "single"
): Promise<void> {
  if (storageKind === "parts") {
    const parts = await db.all<{ tg_chat_id: string; tg_message_id: number }>(
      "SELECT tg_chat_id, tg_message_id FROM file_parts WHERE file_id = ?",
      fileId
    );
    for (const part of parts) await deleteMessage(part.tg_chat_id, part.tg_message_id);
    await db.run("DELETE FROM file_parts WHERE file_id = ?", fileId);
  }
  await deleteMessage(primary.chatId, primary.messageId);
}

/**
 * Drop an abandoned multipart upload: its Telegram part messages, its
 * `file_parts` rows, and its `upload_sessions` row. Safe to call for an id
 * that has no session row (orphan parts) — the session delete is a no-op.
 */
export async function cleanupAbandonedUpload(fileId: string): Promise<void> {
  const parts = await db.all<{ tg_chat_id: string; tg_message_id: number }>(
    "SELECT tg_chat_id, tg_message_id FROM file_parts WHERE file_id = ?",
    fileId
  );
  for (const part of parts) await deleteMessage(part.tg_chat_id, part.tg_message_id);
  await db.run("DELETE FROM file_parts WHERE file_id = ?", fileId);
  await db.run("DELETE FROM upload_sessions WHERE id = ?", fileId);
}
