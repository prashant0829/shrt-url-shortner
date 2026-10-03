import { currentUser } from '../middleware/auth.middleware.js';
import { toDate } from '../utils/dates.js';

const toAnalyticsView = (report) => ({
  code: report.code,
  range: {
    from: report.range.from.toISOString(),
    to: report.range.to.toISOString(),
    interval: report.range.interval,
  },
  totals: report.totals,
  series: report.series.map((point) => ({
    bucket: point.bucket.toISOString(),
    clicks: point.clicks,
  })),
  breakdowns: report.breakdowns,
});

export function createAnalyticsController({ analytics }) {
  async function getLinkAnalytics(req, res) {
    const { from, to, interval, includeBots } = req.input.query;
    const report = await analytics.getLinkAnalytics(req.input.params.code, currentUser(req).id, {
      from: toDate(from),
      to: toDate(to),
      interval,
      includeBots,
    });
    res.json(toAnalyticsView(report));
  }

  return { getLinkAnalytics };
}
