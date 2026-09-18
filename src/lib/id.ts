import { randomBytes } from "node:crypto";

const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

export function newId(len = 12): string {
  // Rejection sampling to avoid modulo bias (57 does not divide 256).
  const max = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < len) {
    const bytes = randomBytes(len - out.length);
    for (let i = 0; i < bytes.length && out.length < len; i++) {
      if (bytes[i] < max) out += ALPHABET[bytes[i] % ALPHABET.length];
    }
  }
  return out;
}

/** Capability token for share links: 32 base64url chars ≈ 192 bits. */
export function newToken(): string {
  return `sh_${randomBytes(24).toString("base64url")}`;
}
