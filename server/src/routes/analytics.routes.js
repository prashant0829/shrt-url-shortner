import { ApiTag, HttpMethod, HttpStatus, RouteSecurity } from '../constants.js';
import { analyticsQuery, analyticsView } from '../schemas/analytics.schemas.js';
import { errorResponses } from '../schemas/error.schemas.js';
import { codeParams } from '../schemas/link.schemas.js';

export function registerAnalyticsRoutes(route, { controller }) {
  route({
    method: HttpMethod.GET,
    path: '/links/:code/analytics',
    security: RouteSecurity.REQUIRED,
    tags: [ApiTag.ANALYTICS],
    summary: 'Clicks over time plus country, browser, OS, device and referrer breakdowns',
    request: { params: codeParams, query: analyticsQuery },
    responses: {
      [HttpStatus.OK]: analyticsView,
      ...errorResponses(HttpStatus.BAD_REQUEST, HttpStatus.UNAUTHORIZED, HttpStatus.NOT_FOUND),
    },
    handler: controller.getLinkAnalytics,
  });
}
