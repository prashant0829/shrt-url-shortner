import { CACHE_TTL_JITTER_RATIO, LINK_CACHE_KEY_PREFIX } from '../constants.js';

// The part of a link the redirect needs, small enough to cache cheaply. Deleted links become
// inactive targets, so redirects answer 410 Gone rather than 404.
export function toRedirectTarget(link) {
  return {
    linkId: link.id,
    url: link.originalUrl,
    expiresAt: link.expiresAt?.toISOString() ?? null,
    isActive: link.isActive && link.deletedAt === null,
  };
}

const cacheKey = (code) => `${LINK_CACHE_KEY_PREFIX}${code}`;

const withJitter = (seconds) => Math.round(seconds * (1 + Math.random() * CACHE_TTL_JITTER_RATIO));

// Cache-aside storage for redirect lookups. `get` resolves `undefined` when the code is not cached
// and `null` when it is cached as "does not exist", so scans over random codes never reach the
// database.
//
// `get` and `set` never throw, because a cache outage must not take redirects down. `delete` does
// throw: a failed invalidation could keep serving a stale or deleted destination.
export function createRedisLinkCache({ redis, logger, metrics, ttlSeconds, negativeTtlSeconds }) {
  function recordFailure(err, operation) {
    metrics.cacheErrors.inc();
    logger.warn({ err, operation }, 'link cache unavailable; falling back to database');
  }

  async function get(code) {
    try {
      const cachedJson = await redis.get(cacheKey(code));
      return cachedJson === null ? undefined : JSON.parse(cachedJson);
    } catch (err) {
      recordFailure(err, 'read');
      return undefined;
    }
  }

  async function set(code, target) {
    const ttl = target === null ? negativeTtlSeconds : withJitter(ttlSeconds);
    try {
      await redis.set(cacheKey(code), JSON.stringify(target), 'EX', ttl);
    } catch (err) {
      recordFailure(err, 'write');
    }
  }

  async function deleteEntry(code) {
    await redis.del(cacheKey(code));
  }

  return { get, set, delete: deleteEntry };
}
