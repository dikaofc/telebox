import { randomBytes } from "node:crypto";

const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

export function newId(len = 12): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Capability token for share links: 32 base64url chars ≈ 192 bits. */
export function newToken(): string {
  return `sh_${randomBytes(24).toString("base64url")}`;
}
