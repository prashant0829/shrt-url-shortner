import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRedisRateLimitStore } from '../../src/infra/redis-rate-limit-store.js';
import { createRedis } from '../../src/infra/redis.js';
import { createLogger } from '../../src/infra/logger.js';
import { resetState } from '../helpers/context.js';
import { TEST_REDIS_URL } from '../helpers/env.js';

const logger = createLogger({ env: 'test', log: { level: 'silent' } });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let redis;
const newStore = (windowMs = 60_000, prefix = 'rl:unit:') => {
  const store = createRedisRateLimitStore(redis, { prefix });
  store.init({ windowMs });
  return store;
};

beforeAll(() => {
  redis = createRedis(TEST_REDIS_URL, logger);
});
afterAll(async () => {
  await redis.quit();
});
beforeEach(resetState);

describe('RedisRateLimitStore', () => {
  it('counts hits and reports when the window ends', async () => {
    const store = newStore(60_000);

    const first = await store.increment('client-a');
    const second = await store.increment('client-a');

    expect([first.totalHits, second.totalHits]).toEqual([1, 2]);
    const msLeft = second.resetTime.getTime() - Date.now();
    expect(msLeft).toBeGreaterThan(58_000);
    expect(msLeft).toBeLessThanOrEqual(60_000);
  });

  it('keeps separate counters per key and per prefix', async () => {
    const a = newStore(60_000, 'rl:one:');
    const b = newStore(60_000, 'rl:two:');

    await a.increment('same-key');
    await a.increment('same-key');

    expect((await a.increment('other-key')).totalHits).toBe(1);
    expect((await b.increment('same-key')).totalHits).toBe(1);
  });

  it('starts the window on the first hit and does not extend it on later hits', async () => {
    const store = newStore(60_000);
    await store.increment('client');
    const ttlBefore = await redis.pttl('rl:unit:client');

    await sleep(150);
    await store.increment('client');
    const ttlAfter = await redis.pttl('rl:unit:client');

    expect(ttlAfter).toBeLessThan(ttlBefore);
  });

  it('starts a fresh window once the old one has expired', async () => {
    const store = newStore(300);
    await store.increment('client');
    await store.increment('client');

    await sleep(450);

    expect((await store.increment('client')).totalHits).toBe(1);
  });

  it('counts exactly under concurrency (the increment is atomic)', async () => {
    const store = newStore(60_000);

    const results = await Promise.all(Array.from({ length: 50 }, () => store.increment('burst')));

    expect(results.map((r) => r.totalHits).sort((x, y) => x - y)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
  });

  it('heals a counter that somehow lost its expiry', async () => {
    const store = newStore(60_000);
    await redis.set('rl:unit:stuck', '5'); // no TTL: would otherwise block a client forever

    const { totalHits, resetTime } = await store.increment('stuck');

    expect(totalHits).toBe(6);
    expect(await redis.pttl('rl:unit:stuck')).toBeGreaterThan(0);
    expect(resetTime.getTime()).toBeGreaterThan(Date.now());
  });

  it('keeps working after Redis forgets its scripts (restart or SCRIPT FLUSH)', async () => {
    const store = newStore(60_000);
    await store.increment('client');

    await redis.script('FLUSH');

    expect((await store.increment('client')).totalHits).toBe(2);
  });

  it('supports decrement and reset', async () => {
    const store = newStore(60_000);
    await store.increment('client');
    await store.increment('client');

    await store.decrement('client');
    expect((await store.increment('client')).totalHits).toBe(2);

    await store.resetKey('client');
    expect((await store.increment('client')).totalHits).toBe(1);
  });

  it('fails loudly when Redis is unreachable, so the limiter can decide to fail open', async () => {
    const dead = createRedis('redis://127.0.0.1:6390/0', logger);
    try {
      const store = createRedisRateLimitStore(dead, { prefix: 'rl:dead:' });
      store.init({ windowMs: 1000 });
      await expect(store.increment('client')).rejects.toThrow();
    } finally {
      dead.disconnect();
    }
  });
});
