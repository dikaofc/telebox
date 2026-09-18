import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DELETED_ROW_RETENTION_MS } from "../src/lib/purge.ts";
import { UPLOAD_SESSION_MAX_AGE_MS } from "../src/lib/multipart.ts";

const require = createRequire(import.meta.url);
(globalThis as { require?: unknown }).require = require;

process.env.DB_PATH = "purge-test.db";

const { default: db } = await import("../src/lib/db.ts");
const { purgeExpired } = await import("../src/lib/purge.ts");

async function reset() {
  await db.exec(`DROP TABLE IF EXISTS file_parts`);
  await db.exec(`DROP TABLE IF EXISTS files`);
  await db.exec(`CREATE TABLE files (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
    sha256 TEXT NOT NULL, tg_chat_id TEXT NOT NULL, tg_message_id INTEGER NOT NULL,
    tg_file_id TEXT NOT NULL, storage_kind TEXT NOT NULL DEFAULT 'single', created_at INTEGER NOT NULL,
    expires_at INTEGER, deleted_at INTEGER
  );
  CREATE TABLE file_parts (
    file_id TEXT NOT NULL, part_index INTEGER NOT NULL, size INTEGER NOT NULL,
    tg_chat_id TEXT NOT NULL, tg_message_id INTEGER NOT NULL, tg_file_id TEXT NOT NULL,
    PRIMARY KEY (file_id, part_index)
  )`);
}

async function insert(id: string, expires_at: number | null, deleted_at: number | null) {
  await db.run(
    `INSERT INTO files (id, user_id, name, mime, size, sha256, tg_chat_id, tg_message_id, tg_file_id, created_at, expires_at, deleted_at)
     VALUES (?, 0, 'x', 'text/plain', 1, 'h', '-100', 1, 'f', 0, ?, ?)`,
    id, expires_at, deleted_at
  );
}

async function sessionIds(): Promise<string[]> {
  return (await db.all<{ id: string }>("SELECT id FROM upload_sessions")).map((x) => x.id).sort();
}

async function ids(): Promise<string[]> {
  return (await db.all<{ id: string }>("SELECT id FROM files")).map((x) => x.id).sort();
}

describe("purgeExpired", () => {
  before(async () => {
    await reset();
    await insert("expired", Date.now() - 1000, null);
    await insert("alive", Date.now() + 60_000, null);
    await insert("retained", null, Date.now() - DELETED_ROW_RETENTION_MS - 1000);
    await insert("fresh-del", null, Date.now() - 1000);
    await insert("no-ttl", null, null);
    await db.run("DELETE FROM file_parts WHERE file_id LIKE 'stale-%'");
    await db.run("DELETE FROM upload_sessions WHERE id LIKE 'stale-%'");
    await db.run(
      `INSERT INTO upload_sessions (id, user_id, name, mime, size, sha256, total_parts, expires_at, created_at)
       VALUES ('stale-old', 0, 'big.bin', 'application/zip', 10, 'h', 2, NULL, ?)`,
      Date.now() - UPLOAD_SESSION_MAX_AGE_MS - 1000
    );
    await db.run(
      "INSERT INTO file_parts (file_id, part_index, size, tg_chat_id, tg_message_id, tg_file_id) VALUES ('stale-old', 0, 5, '-100', 9, 'f9')"
    );
    await db.run(
      `INSERT INTO upload_sessions (id, user_id, name, mime, size, sha256, total_parts, expires_at, created_at)
       VALUES ('stale-fresh', 0, 'big.bin', 'application/zip', 10, 'h', 2, NULL, ?)`,
      Date.now()
    );
  });

  after(async () => {
    // Cleanup of the leftover staging tables: dropping them here would break
    // any later suite that reuses the shared SQLite database file, so rows are
    // removed instead and the tables are left in place.
    await db.run("DELETE FROM file_parts WHERE file_id LIKE 'stale-%'");
    await db.run("DELETE FROM upload_sessions WHERE id LIKE 'stale-%'");
  });

  it("removes expired blobs + retained rows, keeps the rest", async () => {
    assert.deepEqual(await ids(), ["alive", "expired", "fresh-del", "no-ttl", "retained"]);
    const r = await purgeExpired();
    assert.deepEqual(r, { expired: 1, cleaned: 1, uploads: 1 });
    assert.deepEqual(await ids(), ["alive", "fresh-del", "no-ttl"]);
    assert.deepEqual(await sessionIds(), ["stale-fresh"]);
  });

  it("is idempotent", async () => {
    const r = await purgeExpired();
    assert.deepEqual(r, { expired: 0, cleaned: 0, uploads: 0 });
  });
});