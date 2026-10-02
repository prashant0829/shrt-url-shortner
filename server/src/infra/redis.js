import { Redis } from 'ioredis';

/**
 * Fail fast instead of queueing commands during an outage: cache and rate-limiter callers
 * degrade gracefully, and requests never hang waiting for Redis to come back.
 */
const requestScoped = {
  maxRetriesPerRequest: 1,
  connectTimeout: 5_000,
  commandTimeout: 1_000,
};

/** Blocking reads (XREADGROUP BLOCK) must not be cut short by a command timeout. */
const blockingScoped = {
  maxRetriesPerRequest: null,
  connectTimeout: 5_000,
};

/**
 * @param {string} url
 * @param {import('pino').Logger} logger
 * @param {'request' | 'blocking'} [role] `blocking` is for the worker's XREADGROUP BLOCK reads.
 * @returns {Redis}
 */
export function createRedis(url, logger, role = 'request') {
  const client = new Redis(url, role === 'request' ? requestScoped : blockingScoped);
  client.on('error', (err) => logger.error({ err }, 'redis connection error'));
  return client;
}
