import http from 'node:http';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config/index.js';
import { createContainer } from './container.js';
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

const container = createContainer(config);
const { logger } = container;
installCrashHandlers(logger);

const app = createApp(container);
const server = http.createServer(app);

// Longer than typical load-balancer idle timeouts (60 s), so keep-alive sockets are not reset
// underneath the balancer. headersTimeout must exceed keepAliveTimeout.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 30_000;

// Order matters: stop accepting requests and drain in-flight ones, then release connections.
onShutdown(logger, async () => {
  app.locals.shuttingDown = true;
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await container.close();
});

server.on('error', (err) => {
  logger.fatal({ err }, 'failed to start server');
  process.exit(1);
});

server.listen(config.server.port, config.server.host, () => {
  logger.info({ host: config.server.host, port: config.server.port }, 'server listening');
});
