import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { highlight } from "../src/lib/highlight.ts";

describe("highlight", () => {
  it("classifies js: keyword, string, comment, function", () => {
    const t = highlight(`// hi\nconst x = "s";\nfunction f() {}`, "javascript");
    const types = t.map((x) => x.type);
    assert.ok(types.includes("comment"), "has comment");
    assert.ok(types.includes("keyword"), "has keyword (const)");
    assert.ok(types.includes("string"), "has string");
    assert.ok(types.includes("function"), "has function call");
  });

  it("python: # comment and def keyword", () => {
    const t = highlight("def f():\n  # c\n  return 1", "python");
    const types = t.map((x) => x.type);
    assert.ok(types.includes("comment"));
    assert.ok(types.includes("keyword"));
  });

  it("classifies number and hex", () => {
    const t = highlight("let a = 0xff + 10.5;", "javascript");
    assert.ok(t.some((x) => x.type === "number" && x.text === "0xff"));
    assert.ok(t.some((x) => x.type === "number" && x.text === "10.5"));
  });

  it("html: tags and attributes", () => {
    const t = highlight(`<div class="x">hi</div>`, "html");
    const types = t.map((x) => x.type);
    assert.ok(types.includes("tag"));
    assert.ok(types.includes("attr"));
    assert.ok(types.includes("string"));
  });

  it("markdown: heading becomes title", () => {
    const t = highlight("# Hello", "markdown");
    assert.ok(t.some((x) => x.type === "title"));
  });

  it("reconstructs original text", () => {
    const code = "fn main() {\n    println!(\"hi\");\n}";
    const t = highlight(code, "rust");
    assert.equal(t.map((x) => x.text).join(""), code);
  });

  it("empty / unknown language does not throw", () => {
    assert.doesNotThrow(() => highlight("", "zzz"));
    assert.doesNotThrow(() => highlight("plain text", "text"));
  });
});