import {
  ANALYTICS_INTERVAL_MS,
  DEFAULT_ANALYTICS_RANGE_MS,
  ErrorCode,
  MAX_ANALYTICS_BUCKETS,
} from '../constants.js';
import { badRequestError } from '../errors.js';
import { assertLinkOwnedBy } from './link.service.js';

// Bounds the work one analytics request can trigger.
function assertValidRange(from, to, interval) {
  if (from.getTime() >= to.getTime()) {
    throw badRequestError(ErrorCode.INVALID_RANGE, '`from` must be earlier than `to`');
  }

  const bucketCount =
    Math.ceil((to.getTime() - from.getTime()) / ANALYTICS_INTERVAL_MS[interval]) + 1;
  if (bucketCount > MAX_ANALYTICS_BUCKETS) {
    throw badRequestError(
      ErrorCode.RANGE_TOO_LARGE,
      `The range would produce ${bucketCount} ${interval} buckets; the maximum is ${MAX_ANALYTICS_BUCKETS}`,
    );
  }
}

export function createAnalyticsService({ links, clicks, now = () => new Date() }) {
  // `from` defaults to seven days before `to`, and `to` defaults to now.
  async function getLinkAnalytics(code, userId, { from, to, interval, includeBots }) {
    const link = assertLinkOwnedBy(await links.findByCode(code), userId);

    const rangeEnd = to ?? now();
    const rangeStart = from ?? new Date(rangeEnd.getTime() - DEFAULT_ANALYTICS_RANGE_MS);
    assertValidRange(rangeStart, rangeEnd, interval);

    const report = await clicks.getReport({
      linkId: link.id,
      from: rangeStart,
      to: rangeEnd,
      interval,
      includeBots,
    });
    return { code, range: { from: rangeStart, to: rangeEnd, interval }, ...report };
  }

  return { getLinkAnalytics };
}
