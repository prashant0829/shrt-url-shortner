import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { ONE_SECOND_MS, RATE_LIMIT_KEY_PREFIX, RATE_LIMIT_WINDOW_MS } from '../constants.js';
import { tooManyRequestsError } from '../errors.js';
import { createRedisRateLimitStore } from '../infra/redis-rate-limit-store.js';

const unlimited = (_req, _res, next) => next();

const secondsUntil = (date) =>
  Math.max(1, Math.ceil((date.getTime() - Date.now()) / ONE_SECOND_MS));

// Each named limiter keeps its own counters, so a busy endpoint cannot use up another one's budget.
// When `enabled` is false every limiter does nothing (used by load tests).
export function createRateLimiterFactory({ redis, enabled, logger, validate = true }) {
  return function createRateLimiter({ name, requestsPerMinute }) {
    if (!enabled) return unlimited;

    return rateLimit({
      windowMs: RATE_LIMIT_WINDOW_MS,
      limit: requestsPerMinute,
      legacyHeaders: true, // X-RateLimit-Limit, -Remaining and -Reset
      standardHeaders: false,
      store: createRedisRateLimitStore(redis, { prefix: `${RATE_LIMIT_KEY_PREFIX}${name}:` }),
      // If Redis is down, keep serving traffic instead of rejecting everyone.
      passOnStoreError: true,
      validate,
      // Signed-in users are limited per account, everyone else per client IP.
      keyGenerator: (req) =>
        req.auth?.user ? `user:${req.auth.user.id}` : `ip:${ipKeyGenerator(req.ip)}`,
      handler: (req, _res, next) => {
        logger.debug({ limiter: name, key: req.rateLimit.key }, 'rate limit exceeded');
        next(tooManyRequestsError(secondsUntil(req.rateLimit.resetTime)));
      },
    });
  };
}
