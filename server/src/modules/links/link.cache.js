/**
 * The slice of a link the redirect path needs, small enough to cache cheaply.
 * @typedef {object} LinkTarget
 * @property {number} linkId
 * @property {string} url
 * @property {string | null} expiresAt ISO timestamp.
 * @property {boolean} isActive False for links that were disabled or deleted.
 */

/**
 * Cache-aside port for redirect lookups.
 * `undefined` means "not cached"; `null` means "known not to exist" (negative cache, so
 * enumeration attacks on random codes do not reach the database).
 *
 * `get` and `set` are best-effort and never throw, because a cache outage must not take
 * redirects down. `delete` does throw: a failed invalidation could keep serving a stale or
 * deleted destination, so callers need to know.
 *
 * @typedef {object} LinkCache
 * @property {(code: string) => Promise<LinkTarget | null | undefined>} get
 * @property {(code: string, target: LinkTarget | null) => Promise<void>} set
 * @property {(code: string) => Promise<void>} delete
 */

/**
 * @typedef {object} RedisLinkCacheOptions
 * @property {import('ioredis').Redis} redis
 * @property {import('pino').Logger} logger
 * @property {{cacheErrors: {inc: () => void}}} metrics
 * @property {number} ttlSeconds
 * @property {number} negativeTtlSeconds
 */

/** @implements {LinkCache} */
export class RedisLinkCache {
  #options;

  /** @param {RedisLinkCacheOptions} options */
  constructor(options) {
    this.#options = options;
  }

  async get(code) {
    try {
      const raw = await this.#options.redis.get(keyFor(code));
      return raw === null ? undefined : JSON.parse(raw);
    } catch (err) {
      this.#recordFailure(err, 'read');
      return undefined;
    }
  }

  async set(code, target) {
    const ttl =
      target === null ? this.#options.negativeTtlSeconds : withJitter(this.#options.ttlSeconds);
    try {
      await this.#options.redis.set(keyFor(code), JSON.stringify(target), 'EX', ttl);
    } catch (err) {
      this.#recordFailure(err, 'write');
    }
  }

  async delete(code) {
    await this.#options.redis.del(keyFor(code));
  }

  #recordFailure(err, operation) {
    this.#options.metrics.cacheErrors.inc();
    this.#options.logger.warn(
      { err, operation },
      'link cache unavailable; falling back to database',
    );
  }
}

const keyFor = (code) => `link:${code}`;

/**
 * Adds up to 10% to a TTL so entries written together (a burst of new links, a cache warm-up)
 * do not all expire at the same instant and stampede Postgres.
 */
const withJitter = (seconds) => Math.round(seconds * (1 + Math.random() * 0.1));
