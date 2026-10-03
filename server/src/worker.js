import { writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { loadConfigOrExit } from './config/index.js';
import { createPool } from './infra/database.js';
import { createRedis } from './infra/redis.js';
import { createClickConsumer } from './queue/click-consumer.js';
import { createClickRepository } from './repositories/click.repository.js';
import { RedisConnectionRole } from './constants.js';
import { installCrashHandlers, onShutdown } from './infra/lifecycle.js';
import { createLogger } from './infra/logger.js';

const config = loadConfigOrExit();
const logger = createLogger(config);
installCrashHandlers(logger);

const pool = createPool(config.db, logger);
// XREADGROUP BLOCK holds its connection while it waits, so nothing else may share it.
const redis = createRedis(config.redis.url, logger, RedisConnectionRole.BLOCKING);

const { heartbeatFile } = config.clicks;
const writeHeartbeat = heartbeatFile
  ? () => writeFile(heartbeatFile, String(Date.now()))
  : undefined;

const consumer = createClickConsumer({
  redis,
  writer: createClickRepository(pool),
  logger,
  options: {
    streamKey: config.clicks.streamKey,
    group: config.clicks.consumerGroup,
    consumerName: `${hostname()}-${process.pid}`,
    batchSize: config.clicks.batchSize,
    blockMs: config.clicks.blockMs,
    reclaimIdleMs: config.clicks.reclaimIdleMs,
  },
  heartbeat: writeHeartbeat,
});

logger.info(
  { stream: config.clicks.streamKey, group: config.clicks.consumerGroup },
  'click worker started',
);
const consumerStopped = consumer.run();

onShutdown(logger, async () => {
  consumer.stop();
  // Let the batch in progress finish, so nothing is left half-processed.
  await consumerStopped;
  await pool.end();
  await redis.quit().catch(() => redis.disconnect());
});

await consumerStopped;
