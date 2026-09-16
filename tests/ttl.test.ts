import { describe, it } from "node:test";
import assert from "node:assert/strict";

const MIN_TTL = 60;
const MAX_TTL = 30 * 24 * 60 * 60;

function parseTtl(raw: string | null): number | null {
  if (!raw) return null;
  const s = Number(raw);
  if (!Number.isFinite(s)) return null;
  return Math.min(MAX_TTL, Math.max(MIN_TTL, Math.floor(s)));
}

describe("parseTtl", () => {
  it("null input -> null", () => assert.equal(parseTtl(null), null));
  it("empty string -> null", () => assert.equal(parseTtl(""), null));
  it("garbage -> null", () => assert.equal(parseTtl("abc"), null));
  it("below min clamps up", () => assert.equal(parseTtl("10"), 60));
  it("above max clamps down", () => assert.equal(parseTtl("99999999"), MAX_TTL));
  it("in range floors", () => assert.equal(parseTtl("90.7"), 90));
});