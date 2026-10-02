// Atomic fixed-window counter: increment, start the window on the first hit, report time left.
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if hits == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { hits, ttl }
`;

/**
 * Rate-limit counters in Redis, shared by every API replica (a store for express-rate-limit).
 *
 * Uses ioredis's `defineCommand`, so the Lua script is sent lazily and transparently re-sent if
 * Redis forgets it (restart, flush). There is no start-up step that can fail permanently, which
 * matters: a limiter that initialised while Redis was briefly down must still work afterwards.
 */
export class RedisRateLimitStore {
  #redis;
  #prefix;
  #windowMs = 60_000;

  /**
   * @param {import('ioredis').Redis} redis
   * @param {{prefix: string}} options
   */
  constructor(redis, { prefix }) {
    this.#redis = redis;
    this.#prefix = prefix;
    if (typeof redis.rateLimitIncrement !== 'function') {
      redis.defineCommand('rateLimitIncrement', { numberOfKeys: 1, lua: INCREMENT_SCRIPT });
    }
  }

  /** Called once by express-rate-limit with the limiter's options. */
  init(options) {
    this.#windowMs = options.windowMs;
  }

  async increment(key) {
    const [totalHits, ttlMs] = await this.#redis.rateLimitIncrement(
      this.#prefix + key,
      this.#windowMs,
    );
    return { totalHits, resetTime: new Date(Date.now() + ttlMs) };
  }

  async decrement(key) {
    await this.#redis.decr(this.#prefix + key);
  }

  async resetKey(key) {
    await this.#redis.del(this.#prefix + key);
  }
}
