import { currentUser } from '../../http/middleware/auth.js';
import { errorResponse } from '../../shared/http-schemas.js';
import { codeParams } from '../links/link.schemas.js';
import { analyticsQuery, analyticsView } from './analytics.schemas.js';

const toView = (report) => ({
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

/**
 * @param {(definition: import('../../http/route-kit.js').RouteDefinition) => void} route
 * @param {{analytics: import('./analytics.service.js').AnalyticsService}} deps
 */
export function registerAnalyticsRoutes(route, { analytics }) {
  route({
    method: 'get',
    path: '/links/:code/analytics',
    security: 'required',
    tags: ['Analytics'],
    summary: 'Clicks over time plus country, browser, OS, device and referrer breakdowns',
    request: { params: codeParams, query: analyticsQuery },
    responses: { 200: analyticsView, 400: errorResponse, 401: errorResponse, 404: errorResponse },
    handler: async (req, res) => {
      const { from, to, interval, includeBots } = req.input.query;
      const report = await analytics.getLinkAnalytics(req.input.params.code, currentUser(req).id, {
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        interval,
        includeBots,
      });
      res.json(toView(report));
    },
  });
}
