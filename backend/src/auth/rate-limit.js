/**
 * In-memory fixed-window rate limiter.
 *
 * Deliberately process-local: this backend is a single always-on service for
 * one plant, so a shared store would be unnecessary complexity. If the
 * deployment later becomes multi-process, this must move to a shared store.
 *
 * The limiter fails closed: when the window is exhausted the caller is denied.
 */
export function createRateLimiter({ windowMs, max }) {
  const buckets = new Map();

  function prune(now) {
    for (const [key, bucket] of buckets) {
      if (now - bucket.start >= windowMs) buckets.delete(key);
    }
  }

  return {
    check(key, now = Date.now()) {
      if (buckets.size > 10_000) prune(now);

      const bucket = buckets.get(key);
      if (!bucket || now - bucket.start >= windowMs) {
        buckets.set(key, { start: now, count: 1 });
        return { allowed: true, retryAfterMs: 0 };
      }

      bucket.count += 1;
      if (bucket.count > max) {
        return { allowed: false, retryAfterMs: windowMs - (now - bucket.start) };
      }
      return { allowed: true, retryAfterMs: 0 };
    },

    /** Called after a successful authentication so honest users are not throttled. */
    reset(key) {
      buckets.delete(key);
    },

    clear() {
      buckets.clear();
    },

    size() {
      return buckets.size;
    },
  };
}
