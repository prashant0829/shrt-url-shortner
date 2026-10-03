import {
  DependencyStatus,
  HEALTH_CHECK_TIMEOUT_MS,
  HealthStatus,
  HttpStatus,
} from '../constants.js';

// Resolves true if `check` succeeds within the timeout; never throws.
async function isHealthy(check) {
  let timer;
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) => {
        timer = setTimeout(reject, HEALTH_CHECK_TIMEOUT_MS, new Error('health check timed out'));
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const statusOf = (isUp) => (isUp ? DependencyStatus.UP : DependencyStatus.DOWN);

// Health probes for the orchestrator and the metrics endpoint for Prometheus.
export function createSystemController({ pool, redis, metrics }) {
  function live(_req, res) {
    res.json({ status: HealthStatus.OK });
  }

  async function ready(_req, res) {
    const [postgresUp, redisUp] = await Promise.all([
      isHealthy(() => pool.query('SELECT 1')),
      isHealthy(() => redis.ping()),
    ]);
    const allUp = postgresUp && redisUp;

    res.status(allUp ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      status: allUp ? HealthStatus.OK : HealthStatus.DEGRADED,
      checks: { postgres: statusOf(postgresUp), redis: statusOf(redisUp) },
    });
  }

  async function scrapeMetrics(_req, res) {
    res.type(metrics.registry.contentType).send(await metrics.registry.metrics());
  }

  return { live, ready, metrics: scrapeMetrics };
}
