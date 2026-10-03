import { RATE_LIMIT_WINDOW_MS } from '../constants.js';

// Atomic fixed-window counter: increment, start the window on the first hit, report the time left.
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if hits == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { hits, ttl }
`;

// Rate-limit counters in Redis, shared by every API replica (a store for express-rate-limit).
// `defineCommand` sends the script lazily and re-sends it if Redis forgets it, so there is no
// start-up step that can fail permanently while Redis is briefly down.
export function createRedisRateLimitStore(redis, { prefix }) {
  let windowMs = RATE_LIMIT_WINDOW_MS;

  if (typeof redis.rateLimitIncrement !== 'function') {
    redis.defineCommand('rateLimitIncrement', { numberOfKeys: 1, lua: INCREMENT_SCRIPT });
  }

  return {
    // express-rate-limit calls this once with the limiter's options.
    init(options) {
      windowMs = options.windowMs;
    },

    async increment(key) {
      const [totalHits, ttlMs] = await redis.rateLimitIncrement(prefix + key, windowMs);
      return { totalHits, resetTime: new Date(Date.now() + ttlMs) };
    },

    async decrement(key) {
      await redis.decr(prefix + key);
    },

    async resetKey(key) {
      await redis.del(prefix + key);
    },
  };
}
