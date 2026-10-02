import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { TooManyRequestsError } from '../../shared/errors.js';
import { RedisRateLimitStore } from '../redis-rate-limit-store.js';

const passThrough = (_req, _res, next) => next();

const secondsUntil = (date) => Math.max(1, Math.ceil((date.getTime() - Date.now()) / 1000));

/**
 * Returns a factory for named per-minute limiters. Each name has its own counters, so a busy
 * endpoint cannot use up another endpoint's budget.
 *
 * @param {object} options
 * @param {import('ioredis').Redis} options.redis Shared counters make a limit hold across all replicas.
 * @param {boolean} options.enabled When false every limiter is a no-op (e.g. for load tests).
 * @param {import('pino').Logger} options.logger
 * @param {boolean} [options.validate] express-rate-limit's built-in misconfiguration warnings.
 */
export function createLimiterFactory({ redis, enabled, logger, validate = true }) {
  /**
   * @param {object} spec
   * @param {string} spec.name
   * @param {number | ((req: import('express').Request) => number)} spec.perMinute
   */
  return function createLimiter({ name, perMinute }) {
    if (!enabled) return passThrough;

    return rateLimit({
      windowMs: 60_000,
      limit: perMinute,
      legacyHeaders: true, // X-RateLimit-Limit / -Remaining / -Reset
      standardHeaders: false,
      store: new RedisRateLimitStore(redis, { prefix: `rl:${name}:` }),
      // If Redis is down, prefer serving traffic over rejecting everyone.
      passOnStoreError: true,
      validate,
      // Signed-in users are limited per account, everyone else per (subnet-normalised) client IP.
      keyGenerator: (req) =>
        req.auth?.user ? `user:${req.auth.user.id}` : `ip:${ipKeyGenerator(req.ip)}`,
      handler: (req, _res, next) => {
        logger.debug({ limiter: name, key: req.rateLimit.key }, 'rate limit exceeded');
        next(new TooManyRequestsError(secondsUntil(req.rateLimit.resetTime)));
      },
    });
  };
}
