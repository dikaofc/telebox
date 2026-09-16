import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateFile, matchesMagic } from "../src/lib/validation.ts";

describe("magic bytes", () => {
  it("png header matches", () => {
    assert.equal(matchesMagic("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
  });
  it("gif masquerading as png is rejected", () => {
    assert.equal(matchesMagic("image/png", new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), false);
  });
  it("mime with no signature skips check", () => {
    assert.equal(matchesMagic("text/plain", new Uint8Array([0x00, 0x01])), true);
  });
});

describe("validateFile", () => {
  it("accepts png with matching head", () => {
    const head = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(validateFile("a.png", "image/png", 100, head).valid, true);
  });
  it("rejects png with gif head", () => {
    const head = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    assert.equal(validateFile("a.png", "image/png", 100, head).valid, false);
  });
  it("rejects empty file", () => {
    assert.equal(validateFile("a.png", "image/png", 0).valid, false);
  });
  it("rejects extension spoof", () => {
    assert.equal(validateFile("a.gif", "image/png", 100).valid, false);
  });
});
