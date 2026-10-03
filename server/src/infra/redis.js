import { Redis } from 'ioredis';
import { RedisConnectionRole } from '../constants.js';

const CONNECT_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 1_000;

// Fail fast during an outage: the cache and rate limiter degrade gracefully and requests never hang.
const requestOptions = {
  maxRetriesPerRequest: 1,
  connectTimeout: CONNECT_TIMEOUT_MS,
  commandTimeout: COMMAND_TIMEOUT_MS,
};

// XREADGROUP BLOCK waits for new entries, so a command timeout would cut it short.
const blockingOptions = {
  maxRetriesPerRequest: null,
  connectTimeout: CONNECT_TIMEOUT_MS,
};

export function createRedis(url, logger, role = RedisConnectionRole.REQUEST) {
  const options = role === RedisConnectionRole.REQUEST ? requestOptions : blockingOptions;
  const client = new Redis(url, options);
  client.on('error', (err) => logger.error({ err }, 'redis connection error'));
  return client;
}
