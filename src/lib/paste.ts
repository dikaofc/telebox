export const MAX_TITLE = 200;
export const MAX_CONTENT = 100 * 1024; // 100 KB
export const MAX_COMMENT = 2000;

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Avatar is image-only; generic file validation allows txt/svg too. */
export function validateAvatar(mime: string): boolean {
  return AVATAR_MIMES.has(mime);
}

/** Languages offered in the paste composer; free-text otherwise. */
export const LANGUAGES = [
  "text",
  "plaintext",
  "javascript",
  "typescript",
  "python",
  "go",
  "rust",
  "c",
  "cpp",
  "java",
  "json",
  "html",
  "css",
  "sql",
  "bash",
  "markdown",
] as const;

export function normalizeLanguage(raw: string): string {
  const l = raw.trim().toLowerCase().slice(0, 32);
  return l || "text";
}

export function validatePaste(input: {
  title: unknown;
  content: unknown;
  language?: unknown;
}): { ok: true; title: string; content: string; language: string } | { ok: false; error: string } {
  const title = String(input.title ?? "").trim().slice(0, MAX_TITLE);
  const content = String(input.content ?? "");
  if (!title) return { ok: false, error: "title is required" };
  if (content.length === 0) return { ok: false, error: "content is required" };
  if (content.length > MAX_CONTENT) return { ok: false, error: `content too large (max ${MAX_CONTENT} chars)` };
  return { ok: true, title, content, language: normalizeLanguage(String(input.language ?? "text")) };
}

export function validateComment(body: unknown): { ok: true; body: string } | { ok: false; error: string } {
  const b = String(body ?? "").trim();
  if (!b) return { ok: false, error: "comment is required" };
  if (b.length > MAX_COMMENT) return { ok: false, error: `comment too long (max ${MAX_COMMENT} chars)` };
  return { ok: true, body: b };
}