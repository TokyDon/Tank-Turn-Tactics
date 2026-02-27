/**
 * Simple in-memory sliding-window rate limiter.
 * No external dependencies — suitable for single-process deployments (Render free tier).
 *
 * Usage:
 *   router.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }), handler)
 */

const store = new Map(); // key → [timestamp, ...]

// Prune stale entries every 10 minutes to prevent memory growth
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour
  for (const [key, hits] of store.entries()) {
    const recent = hits.filter(t => t > cutoff);
    if (recent.length === 0) store.delete(key);
    else store.set(key, recent);
  }
}, 10 * 60 * 1000).unref(); // .unref() so it doesn't block process exit

/**
 * @param {object} options
 * @param {number} options.windowMs   - Window size in ms (default 15 min)
 * @param {number} options.max        - Max requests per window (default 10)
 * @param {Function} [options.keyFn] - Derive rate-limit key from req (default: IP)
 */
function rateLimit({ windowMs = 15 * 60 * 1000, max = 10, keyFn } = {}) {
  const getKey = keyFn || ((req) => req.ip || req.socket?.remoteAddress || 'unknown');

  return (req, res, next) => {
    const key = getKey(req);
    const now = Date.now();
    const windowStart = now - windowMs;

    const hits = (store.get(key) || []).filter(t => t > windowStart);
    hits.push(now);
    store.set(key, hits);

    if (hits.length > max) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: 'Too many requests — please wait before trying again.' });
    }

    next();
  };
}

module.exports = { rateLimit };
