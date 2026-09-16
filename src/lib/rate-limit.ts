const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

type Result = { allowed: boolean; retryAfter?: number };

// ponytail: in-memory fallback for local dev (single process). On Vercel the
// UPSTASH_* vars are set and this path is unused. Map grows unbounded without
// the 5-min sweep below; acceptable for dev.
const buckets = new Map<string, { count: number; resetAt: number }>();

function checkMemory(key: string, maxRequests: number, windowMs: number): Result {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (bucket.count >= maxRequests) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count++;
  return { allowed: true };
}

// Cleanup stale entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}, 300_000).unref();

async function checkUpstash(key: string, maxRequests: number, windowMs: number): Promise<Result> {
  const seconds = Math.max(1, Math.ceil(windowMs / 1000));
  // INCR then EXPIRE in one pipeline. EXPIRE always runs so no key ever
  // strands without a TTL if a single call fails. Sliding-window semantics:
  // sustained traffic keeps refreshing the window, which is stricter than a
  // fixed window — fine for abuse protection, revisit if legits get caught.
  try {
    const res = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([["incr", key], ["expire", key, seconds]]),
      signal: AbortSignal.timeout(3_000),
      cache: "no-store",
    });
    if (!res.ok) return { allowed: true }; // fail open — infra issue, don't block legit users
    const data = (await res.json()) as { result: number }[];
    const count = data[0]?.result ?? 1;
    if (count > maxRequests) return { allowed: false, retryAfter: seconds };
    return { allowed: true };
  } catch {
    return { allowed: true }; // fail open (timeout/network)
  }
}

export function checkRateLimit(key: string, maxRequests: number, windowMs: number): Promise<Result> | Result {
  if (UPSTASH_URL && UPSTASH_TOKEN) return checkUpstash(key, maxRequests, windowMs);
  return checkMemory(key, maxRequests, windowMs);
}