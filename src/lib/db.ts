import type { SQLInputValue } from "node:sqlite";
import pg from "pg";

/**
 * Async DB facade: SQLite locally, Postgres in prod, same call sites.
 * SQL uses SQLite-style `?` placeholders — the PG backend translates them
 * to `$1..$n` positionally. `run()` returns row counts; callers that need
 * a new row id select it back by a unique key instead of engine-specific
 * last-insert-id APIs.
 */
export interface Db {
  get<T>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
  exec(sql: string): Promise<void>;
}

type Row = Record<string, unknown>;

/** SQLite schema — INTEGER PRIMARY KEY is the rowid alias; auto-assigned. */
const SQLITE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS files (
    id             TEXT PRIMARY KEY,
    user_id        INTEGER NOT NULL DEFAULT 0,
    name           TEXT NOT NULL,
    mime           TEXT NOT NULL,
    size           INTEGER NOT NULL,
    sha256         TEXT NOT NULL,
    tg_chat_id     TEXT NOT NULL,
    tg_message_id  INTEGER NOT NULL,
    tg_file_id     TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    expires_at     INTEGER,
    deleted_at     INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    name         TEXT NOT NULL DEFAULT '',
    key_hash     TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS pastes (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    language    TEXT NOT NULL DEFAULT 'text',
    user_id     INTEGER NOT NULL DEFAULT 0,
    author_name TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS paste_likes (
    paste_id   TEXT NOT NULL,
    actor      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (paste_id, actor)
  );

  CREATE TABLE IF NOT EXISTS paste_stars (
    paste_id   TEXT NOT NULL,
    actor      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (paste_id, actor)
  );

  CREATE TABLE IF NOT EXISTS paste_comments (
    id          TEXT PRIMARY KEY,
    paste_id    TEXT NOT NULL,
    user_id     INTEGER NOT NULL DEFAULT 0,
    author_name TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shares (
    id         TEXT PRIMARY KEY,
    file_id    TEXT NOT NULL,
    token      TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_files_sha256 ON files(sha256);
  CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);
  CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
  CREATE INDEX IF NOT EXISTS idx_pastes_created ON pastes(created_at);
  CREATE INDEX IF NOT EXISTS idx_comments_paste ON paste_comments(paste_id, created_at);
`;

/**
 * Postgres schema. BIGSERIAL for auto ids (int4 would overflow with epoch
 * ms timestamps in the future, so keys/timestamps are BIGINT). FKs are
 * enforced by PG, so users row id=0 must really exist.
 */
const PG_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS files (
    id             TEXT PRIMARY KEY,
    user_id        BIGINT NOT NULL DEFAULT 0 REFERENCES users(id),
    name           TEXT NOT NULL,
    mime           TEXT NOT NULL,
    size           BIGINT NOT NULL,
    sha256         TEXT NOT NULL,
    tg_chat_id     TEXT NOT NULL,
    tg_message_id  BIGINT NOT NULL,
    tg_file_id     TEXT NOT NULL,
    created_at     BIGINT NOT NULL,
    expires_at     BIGINT,
    deleted_at     BIGINT
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users(id),
    name         TEXT NOT NULL DEFAULT '',
    key_hash     TEXT NOT NULL,
    created_at   BIGINT NOT NULL,
    last_used_at BIGINT
  );

  CREATE TABLE IF NOT EXISTS pastes (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    language    TEXT NOT NULL DEFAULT 'text',
    user_id     BIGINT NOT NULL DEFAULT 0,
    author_name TEXT NOT NULL DEFAULT '',
    created_at  BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS paste_likes (
    paste_id   TEXT NOT NULL,
    actor      TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (paste_id, actor)
  );

  CREATE TABLE IF NOT EXISTS paste_stars (
    paste_id   TEXT NOT NULL,
    actor      TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (paste_id, actor)
  );

  CREATE TABLE IF NOT EXISTS paste_comments (
    id          TEXT PRIMARY KEY,
    paste_id    TEXT NOT NULL,
    user_id     BIGINT NOT NULL DEFAULT 0,
    author_name TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL,
    created_at  BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shares (
    id         TEXT PRIMARY KEY,
    file_id    TEXT NOT NULL,
    token      TEXT NOT NULL UNIQUE,
    created_at BIGINT NOT NULL,
    expires_at BIGINT
  );

  CREATE INDEX IF NOT EXISTS idx_files_sha256 ON files(sha256);
  CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);
  CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
  CREATE INDEX IF NOT EXISTS idx_pastes_created ON pastes(created_at);
  CREATE INDEX IF NOT EXISTS idx_comments_paste ON paste_comments(paste_id, created_at);
`;

/** Columns added to existing users tables after the original schema. */
const USER_COLUMN_MIGRATIONS = [
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_file_id TEXT",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_mime TEXT",
];

/** Anonymous uploads use user_id=0; PG enforces the FK so the row must exist. */
const SQLITE_SEED = `INSERT OR IGNORE INTO users (id, email, password_hash, created_at) VALUES (0, 'system', '', 0)`;
const PG_SEED = `INSERT INTO users (id, email, password_hash, created_at) VALUES (0, 'system', '', 0) ON CONFLICT (id) DO NOTHING`;

/* ------------------------------- SQLite ------------------------------- */

class SqliteDb implements Db {
  private db: import("node:sqlite").DatabaseSync | null = null;
  private path: string;

  constructor(path: string) {
    this.path = path;
  }

  // node:sqlite is loaded lazily so Postgres deployments never import it
  // (Vercel's Node may not expose it, and it's not needed in PG mode).
  private conn(): import("node:sqlite").DatabaseSync {
    if (!this.db) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional: node:sqlite must not be a static import so Postgres deployments never load it
      const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
      this.db = new DatabaseSync(this.path);
      this.db.exec(SQLITE_SCHEMA);
      this.db.exec(SQLITE_SEED);
      this.runUserMigrations();
    }
    return this.db;
  }

  // SQLite has no ADD COLUMN IF NOT EXISTS; swallow "duplicate column" errors.
  private runUserMigrations(): void {
    for (const sql of USER_COLUMN_MIGRATIONS) {
      const sqliteSql = sql.replace(/ ADD COLUMN IF NOT EXISTS /g, " ADD COLUMN ");
      try {
        this.db!.exec(sqliteSql);
      } catch (e) {
        if (!String(e).includes("duplicate column name")) throw e;
      }
    }
  }

  get<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    const row = this.conn().prepare(sql).get(...(params as SQLInputValue[])) as Row | undefined;
    return Promise.resolve(row as T | undefined);
  }

  all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    const rows = this.conn().prepare(sql).all(...(params as SQLInputValue[])) as Row[];
    return Promise.resolve(rows as T[]);
  }

  run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    const r = this.conn().prepare(sql).run(...(params as SQLInputValue[]));
    return Promise.resolve({ changes: Number(r.changes) });
  }

  exec(sql: string): Promise<void> {
    this.conn().exec(sql);
    return Promise.resolve();
  }
}

/* ------------------------------- Postgres ------------------------------ */

// BIGINT columns arrive as strings from pg; coerce to numbers so callers
// get the same shapes as SQLite (Date math, comparisons). NUMERIC (SUM/COUNT
// can produce it) too.
pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => Number(v));
pg.types.setTypeParser(pg.types.builtins.INT4, (v: string) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v: string) => Number(v));

function toPgPlaceholders(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

export const __pgInternals = {
  toPgPlaceholders,
  PG_SCHEMA,
  PG_SEED,
  USER_COLUMN_MIGRATIONS,
};

class PgDb implements Db {
  private pool: pg.Pool;
  private ready: Promise<void>;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false },
      max: 3,
    });
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.pool.query(PG_SCHEMA);
    await this.pool.query(PG_SEED);
    for (const sql of USER_COLUMN_MIGRATIONS) {
      await this.pool.query(sql);
    }
  }

  private async ensureReady(): Promise<void> {
    await this.ready;
  }

  async get<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    await this.ensureReady();
    const r = await this.pool.query(toPgPlaceholders(sql), params);
    return r.rows[0] as T | undefined;
  }

  async all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    await this.ensureReady();
    const r = await this.pool.query(toPgPlaceholders(sql), params);
    return r.rows as T[];
  }

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    await this.ensureReady();
    const r = await this.pool.query(toPgPlaceholders(sql), params);
    return { changes: r.rowCount ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.ensureReady();
    await this.pool.query(sql);
  }
}

/* ------------------------------- picker -------------------------------- */

const usePostgres = !!process.env.DATABASE_URL;
const db: Db = usePostgres
  ? new PgDb(process.env.DATABASE_URL as string)
  : new SqliteDb(process.env.DB_PATH ?? "telebox.db");

export default db;