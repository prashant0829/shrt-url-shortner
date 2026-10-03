import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLICK_EVENT_FIELD } from '../../src/constants.js';
import { createClickConsumer } from '../../src/queue/click-consumer.js';
import { createClickRepository } from '../../src/repositories/click.repository.js';
import { createRedisClickPublisher } from '../../src/queue/redis-click-publisher.js';
import { createLinkRepository } from '../../src/repositories/link.repository.js';
import { createConsumer, createTestContext, resetState } from '../helpers/context.js';
import { TEST_REDIS_URL } from '../helpers/env.js';
import { createRedis } from '../../src/infra/redis.js';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bots.html)';

let ctx;
let publisher;
let linkId;
const workers = [];

const streamKey = () => ctx.config.clicks.streamKey;
const GROUP = 'test-workers';

const event = (overrides = {}) => ({
  eventId: randomUUID(),
  linkId,
  occurredAt: new Date().toISOString(),
  visitorHash: 'visitor',
  userAgent: CHROME,
  referrer: null,
  country: 'IN',
  ...overrides,
});

const consumer = (overrides = {}) => {
  const worker = createConsumer(ctx.dependencies, overrides);
  workers.push(worker);
  return worker.consumer;
};

const clickRows = async () =>
  (await ctx.dependencies.pool.query('SELECT count(*)::int AS n FROM clicks')).rows[0].n;

const clickCount = async () =>
  (await ctx.dependencies.pool.query('SELECT click_count FROM links WHERE id = $1', [linkId]))
    .rows[0].click_count;

const pendingCount = async () => {
  const summary = await ctx.dependencies.redis.xpending(streamKey(), GROUP);

  return Number(summary[0]);
};

beforeAll(async () => {
  ctx = await createTestContext();
  publisher = createRedisClickPublisher(ctx.dependencies.redis, {
    streamKey: streamKey(),
    maxLength: 10_000,
  });
});
afterAll(() => ctx.close());

beforeEach(async () => {
  await resetState();
  const link = await createLinkRepository(ctx.dependencies.pool).insert({
    code: 'pipeline',
    originalUrl: 'https://dest.test/',
    userId: null,
    expiresAt: null,
  });
  linkId = link?.id ?? 0;
});

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.close()));
});

describe('click pipeline (Redis Stream -> worker -> Postgres)', () => {
  it('moves published events into Postgres and leaves nothing behind in the stream', async () => {
    await Promise.all([
      publisher.publish(event()),
      publisher.publish(event()),
      publisher.publish(event()),
    ]);
    expect(await ctx.dependencies.redis.xlen(streamKey())).toBe(3);

    expect(await consumer().processOnce()).toBe(3);

    expect(await clickRows()).toBe(3);
    expect(await clickCount()).toBe(3);
    expect(await ctx.dependencies.redis.xlen(streamKey())).toBe(0);
    expect(await pendingCount()).toBe(0);
  });

  it('returns 0 when there is nothing to do', async () => {
    expect(await consumer().processOnce()).toBe(0);
  });

  it('reads at most one batch at a time', async () => {
    for (let i = 0; i < 25; i++) await publisher.publish(event());
    const worker = consumer({ batchSize: 10 });

    expect([
      await worker.processOnce(),
      await worker.processOnce(),
      await worker.processOnce(),
    ]).toEqual([10, 10, 5]);
    expect(await clickRows()).toBe(25);
  });

  it('starts from the beginning of the stream, so events published before the worker existed are kept', async () => {
    await publisher.publish(event());
    // The consumer group does not exist yet; the first worker creates it.
    expect(await consumer().processOnce()).toBe(1);
  });

  it('enriches events: browser, OS, device, referrer host and bot flag', async () => {
    await publisher.publish(event({ referrer: 'https://www.reddit.com/r/node', country: 'DE' }));
    await publisher.publish(event({ userAgent: GOOGLEBOT, country: null }));
    await consumer().processOnce();

    const { rows } = await ctx.dependencies.pool.query(
      'SELECT browser, os, device_type, referrer_host, country, is_bot FROM clicks ORDER BY id',
    );
    expect(rows[0]).toEqual({
      browser: 'Chrome',
      os: 'Windows',
      device_type: 'desktop',
      referrer_host: 'reddit.com',
      country: 'DE',
      is_bot: false,
    });
    expect(rows[1]).toMatchObject({ is_bot: true, country: null });
    expect(await clickCount()).toBe(1); // the bot is stored but not counted
  });

  it('drops malformed entries yet still processes the valid ones in the same batch', async () => {
    const redis = ctx.dependencies.redis;
    await redis.xadd(streamKey(), '*', CLICK_EVENT_FIELD, 'this is not json');
    await redis.xadd(streamKey(), '*', 'unrelated', 'field');
    await redis.xadd(
      streamKey(),
      '*',
      CLICK_EVENT_FIELD,
      JSON.stringify({ eventId: 'not-a-uuid' }),
    );
    await publisher.publish(event());

    expect(await consumer().processOnce()).toBe(4);

    expect(await clickRows()).toBe(1);
    expect(await redis.xlen(streamKey())).toBe(0); // poison messages are acknowledged, not retried forever
    expect(await pendingCount()).toBe(0);
  });

  it('ignores events for links that no longer exist without failing the batch', async () => {
    await publisher.publish(event({ linkId: 987_654 }));
    await publisher.publish(event());

    expect(await consumer().processOnce()).toBe(2);
    expect(await clickRows()).toBe(1);
  });

  it('is idempotent when an event is delivered again after a crash before XACK', async () => {
    const fixed = event();
    await publisher.publish(fixed);

    // First delivery: the worker stores the click, then "crashes" before acknowledging.
    const real = createClickRepository(ctx.dependencies.pool);
    let crashed = false;
    const crashy = {
      insertBatch: async (clicks) => {
        const inserted = await real.insertBatch(clicks);
        if (!crashed) {
          crashed = true;
          throw new Error('crashed before XACK');
        }
        return inserted;
      },
    };
    const first = createRedis(TEST_REDIS_URL, ctx.dependencies.logger, 'blocking');
    workers.push({ close: async () => void first.disconnect() });
    const failing = createClickConsumer({
      redis: first,
      writer: crashy,
      logger: ctx.dependencies.logger,
      options: {
        streamKey: streamKey(),
        group: GROUP,
        consumerName: 'test-consumer',
        batchSize: 10,
        blockMs: 50,
        reclaimIdleMs: 60_000,
        reclaimIntervalMs: 0,
      },
    });
    await expect(failing.processOnce()).rejects.toThrow('crashed before XACK');
    expect(await clickRows()).toBe(1);
    expect(await pendingCount()).toBe(1);

    // The same worker retries its unacknowledged entry: no duplicate row, counter unchanged.
    expect(await failing.processOnce()).toBe(1);
    expect(await clickRows()).toBe(1);
    expect(await clickCount()).toBe(1);
    expect(await pendingCount()).toBe(0);
  });

  it('retries its own failed batch immediately instead of waiting for it to be reclaimed', async () => {
    await publisher.publish(event());

    let failures = 1;
    const real = createClickRepository(ctx.dependencies.pool);
    const flaky = {
      insertBatch: async (clicks) => {
        if (failures-- > 0) throw new Error('database unavailable');
        return real.insertBatch(clicks);
      },
    };
    const redis = createRedis(TEST_REDIS_URL, ctx.dependencies.logger, 'blocking');
    workers.push({ close: async () => void redis.disconnect() });
    const worker = createClickConsumer({
      redis,
      writer: flaky,
      logger: ctx.dependencies.logger,
      // A long idle threshold proves the retry does not rely on reclaiming.
      options: {
        streamKey: streamKey(),
        group: GROUP,
        consumerName: 'solo',
        batchSize: 10,
        blockMs: 50,
        reclaimIdleMs: 3_600_000,
        reclaimIntervalMs: 0,
      },
    });

    await expect(worker.processOnce()).rejects.toThrow('database unavailable');
    expect(await worker.processOnce()).toBe(1);
    expect(await clickRows()).toBe(1);
  });

  it('takes over entries abandoned by a crashed worker', async () => {
    await publisher.publish(event());
    await publisher.publish(event());

    // A worker reads both entries and dies without acknowledging them.
    const dead = createRedis(TEST_REDIS_URL, ctx.dependencies.logger, 'blocking');
    workers.push({ close: async () => void dead.disconnect() });
    await dead.xgroup('CREATE', streamKey(), GROUP, '0', 'MKSTREAM');
    await dead.call(
      'XREADGROUP',
      'GROUP',
      GROUP,
      'dead-worker',
      'COUNT',
      10,
      'STREAMS',
      streamKey(),
      '>',
    );
    expect(await pendingCount()).toBe(2);

    // A healthy worker (reclaimIdleMs: 0 => everything pending counts as abandoned) finishes the job.
    const rescuer = consumer({ consumerName: 'rescuer', reclaimIdleMs: 0 });
    expect(await rescuer.processOnce()).toBe(2);

    expect(await clickRows()).toBe(2);
    expect(await pendingCount()).toBe(0);
  });

  it('does not steal entries that another worker is still processing', async () => {
    await publisher.publish(event());
    const busy = createRedis(TEST_REDIS_URL, ctx.dependencies.logger, 'blocking');
    workers.push({ close: async () => void busy.disconnect() });
    await busy.xgroup('CREATE', streamKey(), GROUP, '0', 'MKSTREAM');
    await busy.call(
      'XREADGROUP',
      'GROUP',
      GROUP,
      'busy-worker',
      'COUNT',
      10,
      'STREAMS',
      streamKey(),
      '>',
    );

    // Default 60s idle threshold: a just-read entry is not considered abandoned.
    expect(await consumer({ consumerName: 'other' }).processOnce()).toBe(0);
    expect(await clickRows()).toBe(0);
  });

  it('run() keeps draining until stop() and then exits cleanly', async () => {
    const worker = consumer();
    const finished = worker.run();

    await publisher.publish(event());
    await vi.waitFor(async () => expect(await clickRows()).toBe(1));
    await publisher.publish(event());
    await vi.waitFor(async () => expect(await clickRows()).toBe(2));

    worker.stop();
    await expect(finished).resolves.toBeUndefined();
  });

  it('run() recovers by itself after the group disappears (e.g. Redis was flushed)', async () => {
    const worker = consumer();
    const finished = worker.run();

    await publisher.publish(event());
    await vi.waitFor(async () => expect(await clickRows()).toBe(1));

    await ctx.dependencies.redis.flushdb(); // stream and consumer group vanish
    await publisher.publish(event());
    await vi.waitFor(async () => expect(await clickRows()).toBe(2), { timeout: 8_000 });

    worker.stop();
    await finished;
  });

  it('beats after every successful poll and goes quiet while failing, so orchestrators can spot a sick worker', async () => {
    const beats = [];
    let attempts = 0;
    let failing = false;
    const real = createClickRepository(ctx.dependencies.pool);
    const writer = {
      insertBatch: async (clicks) => {
        attempts += 1;
        if (failing) throw new Error('database unavailable');
        return real.insertBatch(clicks);
      },
    };
    const redis = createRedis(TEST_REDIS_URL, ctx.dependencies.logger, 'blocking');
    workers.push({ close: async () => void redis.disconnect() });
    const worker = createClickConsumer({
      redis,
      writer,
      logger: ctx.dependencies.logger,
      options: {
        streamKey: streamKey(),
        group: GROUP,
        consumerName: 'beating',
        batchSize: 10,
        blockMs: 50,
        reclaimIdleMs: 3_600_000,
        reclaimIntervalMs: 0,
      },
      heartbeat: async () => {
        beats.push(Date.now());
      },
    });
    const finished = worker.run();

    // Idle polls count as healthy too.
    await vi.waitFor(() => expect(beats.length).toBeGreaterThanOrEqual(3));

    failing = true;
    await publisher.publish(event());
    await vi.waitFor(() => expect(attempts).toBeGreaterThanOrEqual(1));
    const beatsAtFailure = beats.length;

    await new Promise((resolve) => setTimeout(resolve, 1_300)); // covers a retry after the 1s backoff
    expect(beats.length).toBe(beatsAtFailure);

    failing = false; // the database recovers: the retry succeeds and the heartbeat resumes
    await vi.waitFor(() => expect(beats.length).toBeGreaterThan(beatsAtFailure), {
      timeout: 6_000,
    });
    expect(await clickRows()).toBe(1);

    worker.stop();
    await finished;
  });

  it('publisher caps stream length so a dead worker cannot exhaust Redis memory', async () => {
    const capped = createRedisClickPublisher(ctx.dependencies.redis, {
      streamKey: streamKey(),
      maxLength: 100,
    });
    for (let i = 0; i < 400; i++) await capped.publish(event());

    // "~" trimming works in whole blocks, so the length is bounded but not exact.
    expect(await ctx.dependencies.redis.xlen(streamKey())).toBeLessThan(400);
  });
});
