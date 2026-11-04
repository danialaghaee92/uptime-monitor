import { createLogger } from '../lib/logger.js';
import { config } from '../config.js';

const logger = createLogger(config.logLevel, 'rate-limit');

/**
 * محدودکننده نرخ درون‌حافظه‌ای (برای هر پروسه).
 * برای سامانه تک‌نمونه‌ای کافی است؛ در صورت مقیاس افقی باید Redis جایگزین شود.
 */
export function createRateLimiter({ windowMs, max, name = 'general', keyFn = (req) => req.ip || 'unknown' }) {
  const buckets = new Map();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
      if (entry.resetAt <= now) buckets.delete(key);
    }
  }, Math.max(windowMs, 60_000));
  cleanup.unref?.();

  return function rateLimiter(req, res, next) {
    const key = `${name}:${keyFn(req)}`;
    const now = Date.now();
    let entry = buckets.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(key, entry);
    }
    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(remaining));

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      logger.warn(`محدودیت نرخ برای ${key}`);
      return res.status(429).json({
        error: 'rate_limited',
        message: 'تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.',
        retryAfter,
      });
    }
    next();
  };
}
