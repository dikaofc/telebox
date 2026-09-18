import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHUNK_BYTES,
  MAX_UPLOAD_BYTES,
  MAX_PARTS,
  UPLOAD_SESSION_MAX_AGE_MS,
  totalPartsFor,
  expectedPartSize,
  isSessionStale,
  validateInitMeta,
} from "../src/lib/multipart.ts";
import { validateFileMeta } from "../src/lib/validation.ts";

describe("totalPartsFor", () => {
  it("single part for small files", () => {
    assert.equal(totalPartsFor(1), 1);
    assert.equal(totalPartsFor(CHUNK_BYTES), 1);
  });
  it("two parts just over the chunk size", () => {
    assert.equal(totalPartsFor(CHUNK_BYTES + 1), 2);
  });
  it("max file fits in MAX_PARTS", () => {
    assert.ok(totalPartsFor(MAX_UPLOAD_BYTES) <= MAX_PARTS);
  });
});

describe("expectedPartSize", () => {
  it("non-final parts are exactly full", () => {
    const size = CHUNK_BYTES * 2 + 100;
    assert.equal(expectedPartSize(size, 0), CHUNK_BYTES);
    assert.equal(expectedPartSize(size, 1), CHUNK_BYTES);
    assert.equal(expectedPartSize(size, 2), 100);
  });
  it("exact multiples have a full final part", () => {
    assert.equal(expectedPartSize(CHUNK_BYTES * 2, 1), CHUNK_BYTES);
  });
  it("sums back to the file size", () => {
    for (const size of [1, CHUNK_BYTES - 1, CHUNK_BYTES, CHUNK_BYTES + 1, 10 * 1024 * 1024]) {
      let sum = 0;
      for (let i = 0; i < totalPartsFor(size); i++) sum += expectedPartSize(size, i);
      assert.equal(sum, size);
    }
  });
  it("rejects out-of-range indexes", () => {
    assert.throws(() => expectedPartSize(10, -1));
    assert.throws(() => expectedPartSize(10, 1));
  });
});

describe("isSessionStale", () => {
  it("fresh sessions are live", () => {
    assert.equal(isSessionStale(Date.now()), false);
  });
  it("old sessions are stale", () => {
    assert.equal(isSessionStale(Date.now() - UPLOAD_SESSION_MAX_AGE_MS - 1000), true);
  });
});

describe("validateInitMeta", () => {
  const good = { name: "a.zip", mime: "application/zip", size: 10, sha256: "ab".repeat(32) };
  it("accepts valid metadata", () => {
    const r = validateInitMeta(good);
    assert.ok(r.ok);
  });
  it("rejects missing name, bad size, oversized, bad hash", () => {
    assert.equal(validateInitMeta({ ...good, name: "  " }).ok, false);
    assert.equal(validateInitMeta({ ...good, size: 0 }).ok, false);
    assert.equal(validateInitMeta({ ...good, size: MAX_UPLOAD_BYTES + 1 }).ok, false);
    assert.equal(validateInitMeta({ ...good, sha256: "zzz" }).ok, false);
    assert.equal(validateInitMeta({ ...good, mime: "" }).ok, false);
  });
});

describe("validateFileMeta", () => {
  it("accepts allowed mime with matching extension", () => {
    assert.equal(validateFileMeta("a.zip", "application/zip", 10).valid, true);
  });
  it("rejects disallowed mime before any bytes move", () => {
    assert.equal(validateFileMeta("a.exe", "application/x-msdownload", 10).valid, false);
  });
  it("rejects extension spoof", () => {
    assert.equal(validateFileMeta("a.zip", "image/png", 10).valid, false);
  });
  it("rejects non-positive sizes", () => {
    assert.equal(validateFileMeta("a.txt", "text/plain", 0).valid, false);
  });
});
