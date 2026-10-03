const NANOSECONDS_PER_SECOND = 1e9;
const UNMATCHED_ROUTE_LABEL = 'unmatched';

export function httpMetrics(metrics) {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / NANOSECONDS_PER_SECOND;
      metrics.httpDuration.observe(
        {
          method: req.method,
          // The route pattern (such as /:code), never the raw URL, keeps label cardinality bounded.
          route: req.route ? `${req.baseUrl}${req.route.path}` : UNMATCHED_ROUTE_LABEL,
          status: String(res.statusCode),
        },
        elapsedSeconds,
      );
    });
    next();
  };
}
