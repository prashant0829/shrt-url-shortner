import { z } from 'zod';

const liveResponse = z.object({ status: z.literal('ok') });
const readyResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({ postgres: z.enum(['up', 'down']), redis: z.enum(['up', 'down']) }),
});

/** Resolves true if `check` succeeds within the deadline; never throws. */
async function isHealthy(check, timeoutMs = 1_500) {
  let timer;
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) => {
        timer = setTimeout(reject, timeoutMs, new Error('health check timed out'));
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {(definition: import('../../http/route-kit.js').RouteDefinition) => void} route
 * @param {{pool: import('pg').Pool, redis: import('ioredis').Redis}} deps
 */
export function registerHealthRoutes(route, { pool, redis }) {
  route({
    method: 'get',
    path: '/health/live',
    tags: ['System'],
    summary: 'Liveness: the process is running',
    responses: { 200: liveResponse },
    handler: (_req, res) => {
      res.json({ status: 'ok' });
    },
  });

  route({
    method: 'get',
    path: '/health/ready',
    tags: ['System'],
    summary: 'Readiness: Postgres and Redis are reachable',
    responses: { 200: readyResponse, 503: readyResponse },
    handler: async (_req, res) => {
      const [postgres, cache] = await Promise.all([
        isHealthy(() => pool.query('SELECT 1')),
        isHealthy(() => redis.ping()),
      ]);
      const ok = postgres && cache;
      res.status(ok ? 200 : 503).json({
        status: ok ? 'ok' : 'degraded',
        checks: { postgres: postgres ? 'up' : 'down', redis: cache ? 'up' : 'down' },
      });
    },
  });
}
