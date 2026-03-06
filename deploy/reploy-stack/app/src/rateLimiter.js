class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 15 * 60 * 1000;
    this.maxRequests = options.maxRequests || 100;
    this.store = new Map();
  }

  check(ip) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    if (!this.store.has(ip)) this.store.set(ip, []);
    const requests = this.store.get(ip);
    const validRequests = requests.filter(t => t > windowStart);
    this.store.set(ip, validRequests);
    const allowed = validRequests.length < this.maxRequests;
    const remaining = Math.max(0, this.maxRequests - validRequests.length - 1);
    if (allowed) validRequests.push(now);
    let retryAfter = null;
    if (!allowed && validRequests.length > 0) {
      retryAfter = Math.ceil((validRequests[0] + this.windowMs - now) / 1000);
    }
    return { allowed, remaining: allowed ? remaining : 0, retryAfter, limit: this.maxRequests };
  }

  middleware(options = {}) {
    const statusCode = options.statusCode || 429;
    const message = options.message || 'Too Many Requests';
    return (req, res, next) => {
      const ip = req.ip || req.socket?.remoteAddress || 'unknown';
      const result = this.check(ip);
      res.setHeader('RateLimit-Limit', this.maxRequests);
      res.setHeader('RateLimit-Remaining', result.remaining);
      if (result.retryAfter) res.setHeader('Retry-After', result.retryAfter);
      if (!result.allowed) {
        console.warn(`[RATE] Limit exceeded: ${req.method} ${req.url} from ${ip} (${this.maxRequests} in ${this.windowMs / 1000}s)`);
        return res.status(statusCode).json({ error: message, retryAfter: result.retryAfter });
      }
      next();
    };
  }

  reset() { this.store.clear(); }
}

function createRateLimiter(options = {}) {
  const limiter = new RateLimiter(options);
  return limiter.middleware();
}

module.exports = { RateLimiter, createRateLimiter };
