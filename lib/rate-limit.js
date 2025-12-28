function createRateLimiter({ windowMs, max, keyGenerator }) {
  const hits = new Map();

  const cleanup = () => {
    const now = Date.now();
    for (const [key, entry] of hits.entries()) {
      if (entry.resetAt <= now) {
        hits.delete(key);
      }
    }
  };

  const interval = setInterval(cleanup, windowMs).unref();

  return (req, res, next) => {
    if (req.path === '/health') {
      return next();
    }

    const key = keyGenerator(req);
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader('x-ratelimit-limit', String(max));
      res.setHeader('x-ratelimit-remaining', String(Math.max(0, max - 1)));
      res.setHeader('x-ratelimit-reset', String(now + windowMs));
      return next();
    }

    if (entry.count >= max) {
      res.setHeader('retry-after', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ ok: false, error: { message: 'Rate limit exceeded' } });
    }

    entry.count += 1;
    res.setHeader('x-ratelimit-limit', String(max));
    res.setHeader('x-ratelimit-remaining', String(Math.max(0, max - entry.count)));
    res.setHeader('x-ratelimit-reset', String(entry.resetAt));
    return next();
  };
}

export {
  createRateLimiter,
};
