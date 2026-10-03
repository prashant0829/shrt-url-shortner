import {
  CacheControl,
  ContentType,
  ErrorCode,
  HttpHeader,
  HttpStatus,
  RedirectOutcome,
} from '../constants.js';
import { goneError, notFoundError } from '../errors.js';
import { renderErrorPage } from '../utils/error-page.js';
import { isValidShortCode } from '../utils/short-code.js';

const HTML_MEDIA_TYPE = 'text/html';

const firstValue = (value) => (Array.isArray(value) ? value[0] : value);

// Browsers get a readable page; API clients get the standard JSON error.
function rejectUnavailableLink(req, res, status) {
  if (req.headers.accept?.includes(HTML_MEDIA_TYPE)) {
    res.status(status).type(ContentType.HTML).send(renderErrorPage(status));
    return;
  }

  throw status === HttpStatus.NOT_FOUND
    ? notFoundError(ErrorCode.LINK_NOT_FOUND, 'Short link not found')
    : goneError(ErrorCode.LINK_GONE, 'This link has expired or was removed');
}

// `countryHeader` is the lower-cased request header carrying the visitor's country (set by the CDN).
export function createRedirectController({ resolver, tracker, metrics, countryHeader }) {
  async function redirect(req, res) {
    const { code } = req.input.params;

    // Malformed codes cannot exist, so skip the cache and the database entirely.
    const resolution = isValidShortCode(code)
      ? await resolver.resolve(code)
      : { outcome: RedirectOutcome.NOT_FOUND };

    metrics.redirects.inc({ outcome: resolution.outcome });

    if (resolution.outcome !== RedirectOutcome.REDIRECT) {
      const status =
        resolution.outcome === RedirectOutcome.GONE ? HttpStatus.GONE : HttpStatus.NOT_FOUND;
      return rejectUnavailableLink(req, res, status);
    }

    // HEAD requests come from link previewers and uptime checks, not from people.
    if (req.method !== 'HEAD') {
      tracker.track(resolution.target.linkId, {
        ip: req.ip,
        userAgent: req.headers[HttpHeader.USER_AGENT],
        referrer: req.headers[HttpHeader.REFERER],
        country: firstValue(req.headers[countryHeader]),
      });
    }

    // 302, not 301: browsers cache permanent redirects and would skip us on later visits, which
    // would silently break click counting, edits and expiry.
    res
      .status(HttpStatus.FOUND)
      .set({
        [HttpHeader.LOCATION]: resolution.target.url,
        [HttpHeader.CACHE_CONTROL]: CacheControl.NO_STORE,
      })
      .end();
  }

  return { redirect };
}
