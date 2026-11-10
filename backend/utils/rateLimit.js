const createRateLimiter = ({ windowMs, maxAttempts, getKey, message }) => {
  const attemptsByKey = new Map();

  return (req, res, next) => {
    const key = getKey(req);
    const now = Date.now();
    const attempts = attemptsByKey.get(key) || [];
    const recentAttempts = attempts.filter((timestamp) => now - timestamp < windowMs);

    if (recentAttempts.length >= maxAttempts) {
      return res.status(429).json({ success: false, message });
    }

    recentAttempts.push(now);
    attemptsByKey.set(key, recentAttempts);
    return next();
  };
};

module.exports = createRateLimiter;
