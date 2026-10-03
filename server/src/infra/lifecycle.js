import { SHUTDOWN_TIMEOUT_MS } from '../constants.js';

// Continuing after an unhandled error risks running in a corrupt state, so log it and exit.
export function installCrashHandlers(logger) {
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    process.exit(1);
  });
}

// Runs `shutdown` once on SIGINT/SIGTERM. A hung connection cannot block it: the process is
// force-quit after the timeout.
export function onShutdown(logger, shutdown, timeoutMs = SHUTDOWN_TIMEOUT_MS) {
  let shutdownStarted = false;

  const handleSignal = (signal) => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    logger.info({ signal }, 'shutdown signal received');

    const forceExitTimer = setTimeout(() => {
      logger.error('graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, timeoutMs);
    forceExitTimer.unref();

    shutdown().then(
      () => {
        logger.info('shutdown complete');
        process.exit(0);
      },
      (err) => {
        logger.error({ err }, 'error during shutdown');
        process.exit(1);
      },
    );
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
}
