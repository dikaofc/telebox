export const MIN_SHARE_TTL = 60; // 1 minute
export const MAX_SHARE_TTL = 30 * 24 * 60 * 60; // 30 days

/** Parse optional share TTL from `{ ttl }` body. null = never expires. */
export function parseShareTtl(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const s = Number(raw);
  if (!Number.isFinite(s)) return null;
  return Math.min(MAX_SHARE_TTL, Math.max(MIN_SHARE_TTL, Math.floor(s)));
}