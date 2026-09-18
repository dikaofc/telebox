import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateFile, validateFileMeta, matchesMagic, detectMime } from "../src/lib/validation.ts";

describe("magic bytes (detection)", () => {
  it("png header matches", () => {
    assert.equal(matchesMagic("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
  });
  it("gif head does not match png signature", () => {
    assert.equal(matchesMagic("image/png", new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), false);
  });
  it("mime with no signature skips check", () => {
    assert.equal(matchesMagic("text/plain", new Uint8Array([0x00, 0x01])), true);
  });
});

describe("detectMime", () => {
  it("detects png", () => {
    assert.equal(detectMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  });
  it("detects exe (MZ)", () => {
    assert.equal(detectMime(new Uint8Array([0x4d, 0x5a, 0x90, 0x00])), "application/x-msdownload");
  });
  it("detects zip", () => {
    assert.equal(detectMime(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), "application/zip");
  });
  it("detects mp3 frame sync without ID3", () => {
    assert.equal(detectMime(new Uint8Array([0xff, 0xfb, 0x90, 0x00])), "audio/mpeg");
  });
  it("returns null for unknown bytes", () => {
    assert.equal(detectMime(new Uint8Array([0x00, 0x01, 0x02])), null);
  });
});

describe("validateFile (all-types policy)", () => {
  it("accepts any non-empty file regardless of mime", () => {
    assert.equal(validateFile("a.exe", "application/octet-stream", 100).valid, true);
    assert.equal(validateFile("b.rar", "application/vnd.rar", 5).valid, true);
    assert.equal(validateFile("c.bin", "application/x-unknown", 1).valid, true);
  });
  it("rejects empty file", () => {
    assert.equal(validateFile("a.png", "image/png", 0).valid, false);
    assert.equal(validateFileMeta("a.png", "image/png", 0).valid, false);
    assert.equal(validateFileMeta("a.png", "image/png", -1).valid, false);
  });
  it("accepts mime/extension mismatch (detection, not rejection)", () => {
    assert.equal(validateFile("a.gif", "image/png", 100).valid, true);
  });
});
