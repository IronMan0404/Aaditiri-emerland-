import 'server-only';

/**
 * Tiny in-memory sliding-window rate limiter.
 *
 * Designed for "make-abuse-noticeably-harder" scenarios on Vercel:
 *  - Public-facing endpoints that can't gate on auth (e.g. /api/auth/register).
 *  - Quick spam protection where a full Redis/Upstash dep isn't justified.
 *
 * Trade-offs vs a distributed limiter:
 *  - State lives in the lambda's process memory, so each warm instance
 *    keeps its own counters. A determined attacker who spins up across
 *    many cold lambdas can dilute the effective cap. We accept this:
 *    the goal is to raise the floor from "infinite/free" to "noticeably
 *    rate-limited per region", not to be a WAF.
 *  - Counters reset whenever the lambda recycles (typically every few
 *    minutes of idle). That means legitimate users very rarely hit the
 *    limit even if they retry after errors.
 *
 * If we ever add Upstash or any KV at the edge, swap the storage here
 * — the function signatures stay the same.
 */

interface Bucket {
  /** Sorted list of unix-ms timestamps for hits inside the current window. */
  hits: number[];
}

const buckets = new Map<string, Bucket>();

// House-keeping: evict buckets we haven't seen in 1h so the map can't
// grow unboundedly. Run lazily from `consume` — no setInterval, since
// Vercel can freeze the process and any timer leaks across invocations.
const EVICT_AFTER_MS = 60 * 60 * 1000;
let lastEvictAt = 0;

function evictStale(now: number): void {
  if (now - lastEvictAt < 5 * 60 * 1000) return;
  lastEvictAt = now;
  for (const [key, bucket] of buckets) {
    const lastHit = bucket.hits[bucket.hits.length - 1] ?? 0;
    if (now - lastHit > EVICT_AFTER_MS) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Hits inside the window so far, including the current attempt if allowed. */
  count: number;
  /** Caller's max permitted hits (echoes the input limit, useful for headers). */
  limit: number;
  /** Milliseconds until the oldest hit ages out of the window. */
  retryAfterMs: number;
}

/**
 * Try to consume one slot in the bucket identified by `key`. Returns
 * `allowed: false` if the bucket already has `limit` hits inside the
 * trailing `windowMs` window.
 */
export function consume(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  evictStale(now);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }

  // Drop hits that fell out of the window.
  const cutoff = now - windowMs;
  while (bucket.hits.length > 0 && bucket.hits[0] < cutoff) {
    bucket.hits.shift();
  }

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    return {
      allowed: false,
      count: bucket.hits.length,
      limit,
      retryAfterMs: Math.max(0, oldest + windowMs - now),
    };
  }

  bucket.hits.push(now);
  return {
    allowed: true,
    count: bucket.hits.length,
    limit,
    retryAfterMs: 0,
  };
}

/**
 * Best-effort client IP extraction from a Next.js `Request`.
 *
 * Header trust order matters here. A hostile client controls
 * `X-Forwarded-For` / `X-Real-IP` directly — they can set both to any
 * string and our limiter will key on it, so a single attacker can
 * forge an unbounded set of "different IPs" by rotating the header
 * value. The only header that is added by infrastructure we trust is
 * `X-Vercel-Forwarded-For`, which Vercel's edge sets just before the
 * request hits our function and which client-supplied headers cannot
 * override.
 *
 * Order:
 *   1. x-vercel-forwarded-for   (set by Vercel's edge — trusted)
 *   2. x-real-ip                (set by some platforms; safer than XFF)
 *   3. x-forwarded-for          (last-resort fallback for dev/self-host)
 *   4. 'unknown'                (no useful header — limiter still bounds
 *                                aggregate traffic, just less granularly)
 *
 * On Vercel production, step 1 is always present, so the spoofable
 * headers in 2/3 are effectively never read. Local dev uses step 3.
 */
export function getClientIp(req: Request): string {
  const vercelIp = req.headers.get('x-vercel-forwarded-for');
  if (vercelIp) {
    const first = vercelIp.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) {
    const trimmed = realIp.trim();
    if (trimmed) return trimmed;
  }
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}
