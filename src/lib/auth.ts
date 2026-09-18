import { scrypt, randomBytes, timingSafeEqual, scryptSync } from "node:crypto";

/**
 * Password hashing via node:crypto scrypt.
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet minimum
 * recommendation for scrypt: N = 2^17 (131072), r = 8, p = 1. Key length is
 * 64 bytes. On a typical server core this costs ~100–300 ms per hash, which
 * is the intended anti-brute-force budget; do not lower it without a
 * documented reason.
 */

// Legacy parameters from the original schema-less storage format. Kept only
// so accounts created before the parameter upgrade can still log in; each
// successful legacy verification transparently rehashes at the current cost.
const LEGACY = {
  cost: 16384, // N = 2^14
  blockSize: 8, // r
  parallelization: 1, // p
  keylen: 64,
} as const;

const CURRENT = {
  cost: 1 << 17, // N = 131072
  blockSize: 8, // r
  parallelization: 1, // p
  keylen: 64,
} as const;

const SCRYPT_KEYLEN = CURRENT.keylen;
const SALT_BYTES = 16;

const STORAGE_PREFIX = "scrypt";
const STORAGE_VERSION = "v17"; // encodes N=2^17, r=8, p=1
// Legacy rows have no prefix: "<salt-hex>:<hash-hex>" (salt=16B, key=64B).
const LEGACY_SALT_HEX_LEN = LEGACY.keylen === 64 ? 32 : 32;
const LEGACY_HASH_HEX_LEN = LEGACY.keylen * 2;

function scryptAsync(
  password: string,
  salt: Buffer,
  params: { cost: number; blockSize: number; parallelization: number; keylen: number }
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      params.keylen,
      {
        cost: params.cost,
        blockSize: params.blockSize,
        parallelization: params.parallelization,
        maxmem: 132 * params.cost * params.blockSize, // headroom above 128*N*r
      },
      (err, buf) => (err ? reject(err) : resolve(buf))
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scryptAsync(password, salt, CURRENT);
  return `${STORAGE_PREFIX}:${STORAGE_VERSION}:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export type PasswordVerifyResult = {
  ok: boolean;
  /**
   * When true, `stored` used legacy parameters and a successful login must
   * transparently rehash-and-persist at the current parameters (defense in
   * depth against a stale database).
   */
  needsRehash: boolean;
};

/**
 * Constant-time password verification. Never throws on malformed input —
 * anything that does not parse as a stored hash simply fails verification.
 */
export async function verifyPassword(password: string, stored: string): Promise<PasswordVerifyResult> {
  try {
    const s = String(stored ?? "");

    // Current format: scrypt:v17:<salt>:<hash>
    if (s.startsWith(`${STORAGE_PREFIX}:${STORAGE_VERSION}:`)) {
      const parts = s.split(":");
      if (parts.length !== 4) return { ok: false, needsRehash: false };
      const salt = Buffer.from(parts[2], "hex");
      const hash = Buffer.from(parts[3], "hex");
      if (salt.length !== SALT_BYTES || hash.length !== SCRYPT_KEYLEN) {
        return { ok: false, needsRehash: false };
      }
      const candidate = await scryptAsync(password, salt, CURRENT);
      return { ok: timingSafeEqual(hash, candidate), needsRehash: false };
    }

    // Legacy format: <salt-hex>:<hash-hex> at the old cost parameters.
    if (!s.includes(":")) return { ok: false, needsRehash: false };
    const idx = s.indexOf(":");
    const saltHex = s.slice(0, idx);
    const hashHex = s.slice(idx + 1);
    if (saltHex.length !== LEGACY_SALT_HEX_LEN || hashHex.length !== LEGACY_HASH_HEX_LEN) {
      return { ok: false, needsRehash: false };
    }
    const salt = Buffer.from(saltHex, "hex");
    const hash = Buffer.from(hashHex, "hex");
    if (salt.length !== SALT_BYTES || hash.length !== LEGACY.keylen) {
      return { ok: false, needsRehash: false };
    }
    const candidate = await scryptAsync(password, salt, LEGACY);
    // Still run the comparison even if lengths look wrong above — unreachable
    // here, but keep the flow constant-shaped.
    if (hash.length !== candidate.length) return { ok: false, needsRehash: false };
    return { ok: timingSafeEqual(hash, candidate), needsRehash: true };
  } catch {
    return { ok: false, needsRehash: false };
  }
}

/**
 * Reference hash used by login to equalize timing between "unknown email" and
 * "wrong password": it always parses and always runs the full scrypt cost.
 * Holds no user data and matches nothing.
 */
export function referenceHash(): string {
  const salt = Buffer.alloc(SALT_BYTES, 0);
  return scryptSync("telebox-reference-hash", salt, CURRENT.keylen, {
    cost: CURRENT.cost,
    blockSize: CURRENT.blockSize,
    parallelization: CURRENT.parallelization,
    maxmem: 132 * CURRENT.cost * CURRENT.blockSize,
  }).toString("hex");
}

export { SCRYPT_KEYLEN };
