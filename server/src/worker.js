import { writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { ConfigError, loadConfig } from './config/index.js';
import { createPool } from './infra/database.js';
import { createRedis } from './infra/redis.js';
import { ClickConsumer } from './modules/analytics/click-consumer.js';
import { ClickRepository } from './modules/analytics/click.repository.js';
import { createLogger } from './shared/logger.js';
import { installCrashHandlers, onShutdown } from './shared/lifecycle.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const logger = createLogger(config);
installCrashHandlers(logger);

const pool = createPool(config.db, logger);
// A dedicated connection: XREADGROUP BLOCK holds it, so nothing else may share it.
const redis = createRedis(config.redis.url, logger, 'blocking');

const consumer = new ClickConsumer({
  redis,
  writer: new ClickRepository(pool),
  logger,
  options: {
    streamKey: config.clicks.streamKey,
    group: config.clicks.consumerGroup,
    consumerName: `${hostname()}-${process.pid}`,
    batchSize: config.clicks.batchSize,
    blockMs: config.clicks.blockMs,
    reclaimIdleMs: config.clicks.reclaimIdleMs,
  },
  heartbeat: config.clicks.heartbeatFile
    ? () => writeFile(config.clicks.heartbeatFile, String(Date.now()))
    : undefined,
});

logger.info(
  { stream: config.clicks.streamKey, group: config.clicks.consumerGroup },
  'click worker started',
);
const finished = consumer.run();

onShutdown(logger, async () => {
  consumer.stop();
  // Let the batch in progress finish so nothing is left half-processed.
  await finished;
  await pool.end();
  await redis.quit().catch(() => redis.disconnect());
});

await finished;
