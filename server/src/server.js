import { createApp } from './app.js';
import { loadConfigOrExit } from './config/index.js';
import { createDependencies } from './dependencies.js';
import { HEADERS_TIMEOUT_MS, KEEP_ALIVE_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from './constants.js';
import { installCrashHandlers, onShutdown } from './infra/lifecycle.js';

const config = loadConfigOrExit();
const dependencies = createDependencies(config);
const { logger } = dependencies;
installCrashHandlers(logger);

const app = createApp(dependencies);

// app.listen() returns the Node http.Server that Express runs on. We need it for the timeouts and
// for closing the server on shutdown.
const server = app.listen(config.server.port, config.server.host);
server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
server.headersTimeout = HEADERS_TIMEOUT_MS;
server.requestTimeout = REQUEST_TIMEOUT_MS;

server.on('listening', () => {
  logger.info({ host: config.server.host, port: config.server.port }, 'server listening');
});

server.on('error', (err) => {
  logger.fatal({ err }, 'failed to start server');
  process.exit(1);
});

// Order matters: stop accepting requests and drain the ones in flight, then release connections.
onShutdown(logger, async () => {
  app.locals.shuttingDown = true;
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await dependencies.close();
});
