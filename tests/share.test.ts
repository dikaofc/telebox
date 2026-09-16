import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseShareTtl } from "../src/lib/share.ts";
import { newToken } from "../src/lib/id.ts";

describe("parseShareTtl", () => {
  it("null/undefined/empty -> null (never expires)", () => {
    assert.equal(parseShareTtl(undefined), null);
    assert.equal(parseShareTtl(null), null);
    assert.equal(parseShareTtl(""), null);
  });
  it("clamps to 60s minimum", () => assert.equal(parseShareTtl(10), 60));
  it("clamps to 30d maximum", () => assert.equal(parseShareTtl(99999999), 30 * 24 * 60 * 60));
  it("floors in range", () => assert.equal(parseShareTtl(90.7), 90));
  it("garbage -> null", () => assert.equal(parseShareTtl("abc"), null));
});

describe("newToken", () => {
  it("has share prefix, 32+ chars, unique", () => {
    const a = newToken();
    const b = newToken();
    assert.ok(a.startsWith("sh_"));
    assert.ok(a.length >= 32);
    assert.notEqual(a, b);
  });
});