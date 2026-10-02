/**
 * Records request latency per route.
 * @param {import('../../infra/metrics.js').Metrics} metrics
 */
export function httpMetrics(metrics) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      metrics.httpDuration.observe(
        {
          method: req.method,
          // The route pattern (e.g. /:code), never the raw URL, keeps label cardinality bounded.
          route: req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched',
          status: String(res.statusCode),
        },
        Number(process.hrtime.bigint() - start) / 1e9,
      );
    });
    next();
  };
}
