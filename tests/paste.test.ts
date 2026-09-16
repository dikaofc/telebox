import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validatePaste, validateComment, normalizeLanguage } from "../src/lib/paste.ts";

describe("validatePaste", () => {
  it("rejects empty title", () => {
    assert.equal(validatePaste({ title: "", content: "x" }).ok, false);
  });
  it("rejects empty content", () => {
    assert.equal(validatePaste({ title: "t", content: "" }).ok, false);
  });
  it("rejects oversized content", () => {
    assert.equal(validatePaste({ title: "t", content: "x".repeat(100 * 1024 + 1) }).ok, false);
  });
  it("accepts valid input and normalizes language", () => {
    const r = validatePaste({ title: "  hi ", content: "body", language: " PYTHON " });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.title, "hi");
      assert.equal(r.language, "python");
    }
  });
  it("defaults language to text", () => {
    const r = validatePaste({ title: "t", content: "c" });
    assert.ok(r.ok && r.language === "text");
  });
});

describe("validateComment", () => {
  it("rejects empty", () => assert.equal(validateComment("  ").ok, false));
  it("rejects too long", () => assert.equal(validateComment("x".repeat(2001)).ok, false));
  it("accepts normal", () => assert.ok(validateComment("nice").ok));
});

describe("normalizeLanguage", () => {
  it("lowercases and trims", () => {
    assert.equal(normalizeLanguage(" TypeScript "), "typescript");
  });
  it("falls back to text", () => {
    assert.equal(normalizeLanguage(""), "text");
  });
});