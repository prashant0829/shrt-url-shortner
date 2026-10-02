import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client';

/**
 * Each app instance owns its registry (instead of the global one) so that several instances
 * can coexist in one process, which the integration tests rely on.
 */
export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  return {
    registry,
    httpDuration: new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency in seconds',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
      registers: [registry],
    }),
    redirects: new Counter({
      name: 'redirects_total',
      help: 'Short-link lookups by outcome',
      labelNames: ['outcome'],
      registers: [registry],
    }),
    cacheLookups: new Counter({
      name: 'link_cache_lookups_total',
      help: 'Link cache lookups by result (hit, negative_hit, miss)',
      labelNames: ['result'],
      registers: [registry],
    }),
    cacheErrors: new Counter({
      name: 'link_cache_errors_total',
      help: 'Link cache operations that failed and were skipped',
      registers: [registry],
    }),
    clicksEnqueued: new Counter({
      name: 'clicks_enqueued_total',
      help: 'Click events pushed to the stream, by result',
      labelNames: ['result'],
      registers: [registry],
    }),
  };
}

/** @typedef {ReturnType<typeof createMetrics>} Metrics */

/** Exposes the click-stream backlog so operators can alert on a worker falling behind. */
export function registerStreamBacklogGauge(metrics, redis, streamKey) {
  new Gauge({
    name: 'click_stream_length',
    help: 'Click events waiting in (or pending on) the Redis stream',
    registers: [metrics.registry],
    async collect() {
      try {
        this.set(await redis.xlen(streamKey));
      } catch {
        // Redis is unreachable: leave the gauge unset rather than failing the whole scrape.
      }
    },
  });
}
