import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DELETED_ROW_RETENTION_MS } from "../src/lib/purge.ts";

const require = createRequire(import.meta.url);
(globalThis as { require?: unknown }).require = require;

process.env.DB_PATH = "purge-test.db";

const { default: db } = await import("../src/lib/db.ts");
const { purgeExpired } = await import("../src/lib/purge.ts");

async function reset() {
  await db.exec(`DROP TABLE IF EXISTS files`);
  await db.exec(`CREATE TABLE files (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
    sha256 TEXT NOT NULL, tg_chat_id TEXT NOT NULL, tg_message_id INTEGER NOT NULL,
    tg_file_id TEXT NOT NULL, created_at INTEGER NOT NULL,
    expires_at INTEGER, deleted_at INTEGER
  )`);
}

function insert(id: string, expires_at: number | null, deleted_at: number | null) {
  void db.run(
    `INSERT INTO files (id, user_id, name, mime, size, sha256, tg_chat_id, tg_message_id, tg_file_id, created_at, expires_at, deleted_at)
     VALUES (?, 0, 'x', 'text/plain', 1, 'h', '-100', 1, 'f', 0, ?, ?)`,
    id, expires_at, deleted_at
  );
}

async function ids(): Promise<string[]> {
  return (await db.all<{ id: string }>("SELECT id FROM files")).map((x) => x.id).sort();
}

describe("purgeExpired", () => {
  before(async () => {
    await reset();
    insert("expired", Date.now() - 1000, null);
    insert("alive", Date.now() + 60_000, null);
    insert("retained", null, Date.now() - DELETED_ROW_RETENTION_MS - 1000);
    insert("fresh-del", null, Date.now() - 1000);
    insert("no-ttl", null, null);
  });

  after(async () => {
    await db.exec("DROP TABLE IF EXISTS files");
  });

  it("removes expired blobs + retained rows, keeps the rest", async () => {
    assert.deepEqual(await ids(), ["alive", "expired", "fresh-del", "no-ttl", "retained"]);
    const r = await purgeExpired();
    assert.deepEqual(r, { expired: 1, cleaned: 1 });
    assert.deepEqual(await ids(), ["alive", "fresh-del", "no-ttl"]);
  });

  it("is idempotent", async () => {
    const r = await purgeExpired();
    assert.deepEqual(r, { expired: 0, cleaned: 0 });
  });
});