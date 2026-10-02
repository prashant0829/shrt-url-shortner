import { z } from 'zod';
import { GoneError, NotFoundError } from '../../shared/errors.js';
import { errorResponse } from '../../shared/http-schemas.js';
import { isValidCode } from '../links/link-code.js';
import { renderErrorPage } from './error-page.js';

const firstValue = (value) => (Array.isArray(value) ? value[0] : value);

/** Browsers get a readable page; API clients get the standard JSON error. */
function rejectDeadLink(req, res, status) {
  if (req.headers.accept?.includes('text/html')) {
    res.status(status).type('text/html; charset=utf-8').send(renderErrorPage(status));
    return;
  }
  throw status === 404
    ? new NotFoundError('LINK_NOT_FOUND', 'Short link not found')
    : new GoneError('LINK_GONE', 'This link has expired or was removed');
}

/**
 * @param {(definition: import('../../http/route-kit.js').RouteDefinition) => void} route
 * @param {object} deps
 * @param {import('./link-resolver.js').LinkResolver} deps.resolver
 * @param {import('../analytics/click-tracker.js').ClickTracker} deps.tracker
 * @param {{redirects: {inc: (labels: {outcome: string}) => void}}} deps.metrics
 * @param {string} deps.countryHeader Lower-cased request header carrying the visitor's country (set by the CDN).
 */
export function registerRedirectRoutes(route, { resolver, tracker, metrics, countryHeader }) {
  route({
    method: 'get',
    path: '/:code',
    tags: ['Links'],
    summary: 'Redirect to the destination (HTTP 302)',
    description:
      'Public endpoint. Answers 404 for unknown codes and 410 for expired, disabled or deleted links.',
    request: { params: z.object({ code: z.string().describe('Short code or custom alias') }) },
    responses: { 302: null, 404: errorResponse, 410: errorResponse },
    handler: async (req, res) => {
      const { code } = req.input.params;

      // Malformed codes cannot exist; skip the cache and database entirely.
      const resolution = isValidCode(code) ? await resolver.resolve(code) : { status: 'not_found' };

      metrics.redirects.inc({ outcome: resolution.status });

      if (resolution.status !== 'redirect') {
        return rejectDeadLink(req, res, resolution.status === 'gone' ? 410 : 404);
      }

      // HEAD requests come from link previewers and uptime checks, not from people.
      if (req.method !== 'HEAD') {
        tracker.track(resolution.target.linkId, {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          referrer: req.headers.referer,
          country: firstValue(req.headers[countryHeader]),
        });
      }

      // 302, not 301: browsers cache permanent redirects and would skip us on later visits,
      // which would silently break click counting and make edits/expiry ineffective.
      // The Location is already canonical (validated when the link was created).
      res.status(302).set({ location: resolution.target.url, 'cache-control': 'no-store' }).end();
    },
  });
}
