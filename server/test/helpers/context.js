import { Redis } from 'ioredis';
import pg from 'pg';
import { expect } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { createContainer } from '../../src/container.js';
import { createRedis } from '../../src/infra/redis.js';
import { ClickConsumer } from '../../src/modules/analytics/click-consumer.js';
import { ClickRepository } from '../../src/modules/analytics/click.repository.js';
import { ScryptPasswordHasher } from '../../src/modules/auth/password-hasher.js';
import { TEST_DATABASE_URL, TEST_ENV, TEST_REDIS_URL } from './env.js';
import { withInject } from './http.js';

// Connections used only to wipe state between tests, independent of the app under test
// (which may deliberately be pointed at a dead Redis).
let adminPool;
let adminRedis;

/** Builds the real application (real Postgres, real Redis) with cheap password hashing. */
export async function createTestContext(overrides = {}) {
  const config = loadConfig({ ...TEST_ENV, ...overrides });
  const container = createContainer(config, {
    passwordHasher: new ScryptPasswordHasher({ N: 1024, r: 8, p: 1 }),
  });
  const app = withInject(createApp(container));

  return {
    app,
    container,
    config,
    async close() {
      await container.close();
      await closeAdminConnections();
    },
  };
}

/** Empties every table and the test Redis database. Guarded so it can only hit test data. */
export async function resetState() {
  const redisDb = Number(new URL(TEST_REDIS_URL).pathname.slice(1) || '0');
  if (!TEST_DATABASE_URL.includes('test') || redisDb === 0) {
    throw new Error('resetState() only runs against a test database and a non-zero Redis db index');
  }

  adminPool ??= new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  adminRedis ??= new Redis(TEST_REDIS_URL);
  await adminPool.query('TRUNCATE users, links, clicks RESTART IDENTITY CASCADE');
  await adminRedis.flushdb();
}

async function closeAdminConnections() {
  const [pool, redis] = [adminPool, adminRedis];
  adminPool = adminRedis = undefined;
  await pool?.end();
  await redis?.quit().catch(() => undefined);
}

let userCounter = 0;

export async function signUp(app, email = `user${++userCounter}-${Date.now()}@example.com`) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'correct-horse-battery' },
  });
  expect(response.statusCode).toBe(201);

  const body = response.json();
  return {
    token: body.token,
    userId: body.user.id,
    email: body.user.email,
    headers: { authorization: `Bearer ${body.token}` },
  };
}

export async function createLink(app, headers, payload) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/links', headers, payload });
  expect(response.statusCode, response.body).toBe(201);
  return response.json();
}

/** A click worker with its own blocking Redis connection, tuned for fast, deterministic tests. */
export function createConsumer(container, overrides = {}) {
  const redis = createRedis(TEST_REDIS_URL, container.logger, 'blocking');
  const consumer = new ClickConsumer({
    redis,
    writer: new ClickRepository(container.pool),
    logger: container.logger,
    options: {
      streamKey: container.config.clicks.streamKey,
      group: 'test-workers',
      consumerName: 'test-consumer',
      batchSize: 100,
      blockMs: 50,
      reclaimIdleMs: 60_000,
      reclaimIntervalMs: 0,
      ...overrides,
    },
  });

  return {
    consumer,
    redis,
    async close() {
      await redis.quit().catch(() => redis.disconnect());
    },
  };
}

/** Processes every click currently in the stream; returns how many entries were consumed. */
export async function drainClicks(container) {
  const worker = createConsumer(container);
  try {
    let total = 0;
    for (;;) {
      const handled = await worker.consumer.processOnce();
      if (handled === 0) return total;
      total += handled;
    }
  } finally {
    await worker.close();
  }
}
