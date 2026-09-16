import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { __pgInternals } from "../src/lib/db.ts";

const { toPgPlaceholders, PG_SCHEMA, PG_SEED } = __pgInternals;

let pglite: PGlite;

const q = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
  const r = await pglite.query(sql, params);
  return r.rows as unknown as T[];
};

before(async () => {
  pglite = new PGlite();
  await pglite.exec(PG_SCHEMA);
  await pglite.exec(PG_SEED);
});

describe("pg placeholder translation", () => {
  it("maps ? to $1..$n positionally", () => {
    assert.equal(toPgPlaceholders("SELECT * FROM t WHERE a = ? AND b = ?"), "SELECT * FROM t WHERE a = $1 AND b = $2");
  });
  it("leaves no-placeholder SQL untouched", () => {
    assert.equal(toPgPlaceholders("SELECT COUNT(*) FROM files"), "SELECT COUNT(*) FROM files");
  });
});

describe("postgres schema + seed", () => {
  it("seeds system user id=0", async () => {
    const rows = await q<{ id: number; email: string }>("SELECT id, email FROM users WHERE id = 0");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, "system");
  });

  it("seed is idempotent", async () => {
    await pglite.exec(PG_SEED);
    const rows = await q<{ c: number }>("SELECT COUNT(*)::int AS c FROM users WHERE id = 0");
    assert.equal(rows[0].c, 1);
  });
});

describe("postgres query shapes used by app", () => {
  it("insert user, select back by email", async () => {
    await pglite.query("INSERT INTO users (email, password_hash, created_at) VALUES ($1, $2, $3)", [
      "pg-test@example.com", "hash", Date.now(),
    ]);
    const rows = await q<{ id: number }>("SELECT id FROM users WHERE email = $1", ["pg-test@example.com"]);
    assert.ok(rows[0].id > 0);
  });

  it("insert file with FK to user 0", async () => {
    await pglite.query(
      `INSERT INTO files (id, user_id, name, mime, size, sha256, tg_chat_id, tg_message_id, tg_file_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      ["testid1", 0, "a.txt", "text/plain", 10, "deadbeef", "-100", 1, "file1", Date.now(), null],
    );
    const rows = await q<{ name: string }>("SELECT name FROM files WHERE id = $1", ["testid1"]);
    assert.equal(rows[0].name, "a.txt");
  });

  it("dedup query matches inserted file", async () => {
    const rows = await q<{ id: string }>(
      "SELECT id FROM files WHERE sha256 = $1 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > $2)",
      ["deadbeef", Date.now()],
    );
    assert.equal(rows[0].id, "testid1");
  });

  it("expired file not matched by dedup", async () => {
    await pglite.query(
      `INSERT INTO files (id, user_id, name, mime, size, sha256, tg_chat_id, tg_message_id, tg_file_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      ["testid2", 0, "b.txt", "text/plain", 5, "cafebabe", "-100", 2, "file2", Date.now(), 1],
    );
    const rows = await q<{ id: string }>(
      "SELECT id FROM files WHERE sha256 = $1 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > $2)",
      ["cafebabe", Date.now()],
    );
    assert.equal(rows.length, 0);
  });

  it("dedup is scoped by owner", async () => {
    const rows = await q<{ id: string }>(
      "SELECT id FROM files WHERE sha256 = $1 AND user_id = $2 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > $3)",
      ["deadbeef", 999, Date.now()],
    );
    assert.equal(rows.length, 0); // different owner -> no match
    const own = await q<{ id: string }>(
      "SELECT id FROM files WHERE sha256 = $1 AND user_id = $2 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > $3)",
      ["deadbeef", 0, Date.now()],
    );
    assert.equal(own[0].id, "testid1");
  });

  it("bigint timestamps come back as numbers", async () => {
    const rows = await q<{ created_at: number }>("SELECT created_at FROM files WHERE id = $1", ["testid1"]);
    assert.equal(typeof rows[0].created_at, "number");
  });

  it("admin aggregate query", async () => {
    const rows = await q<{ total_files: number; total_size: number; unique_shas: number }>(
      "SELECT COUNT(*) as total_files, COALESCE(SUM(size), 0) as total_size, COUNT(DISTINCT sha256) as unique_shas FROM files WHERE deleted_at IS NULL",
    );
    assert.equal(typeof rows[0].total_files, "number");
    assert.ok(rows[0].total_size > 0);
  });
});