/** Logs and exits on errors nobody handled: continuing after them risks running in a corrupt state. */
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

/**
 * Runs `shutdown` once on SIGINT/SIGTERM and forces the process to exit if it takes too long,
 * so a hung connection can never keep a container from stopping.
 */
export function onShutdown(logger, shutdown, timeoutMs = 15_000) {
  let started = false;

  const handle = (signal) => {
    if (started) return;
    started = true;
    logger.info({ signal }, 'shutdown signal received');

    const force = setTimeout(() => {
      logger.error('graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, timeoutMs);
    force.unref();

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

  process.on('SIGINT', handle);
  process.on('SIGTERM', handle);
}
