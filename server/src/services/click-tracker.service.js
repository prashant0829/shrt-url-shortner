import { createHmac, randomUUID } from 'node:crypto';
import {
  ClickEnqueueResult,
  MAX_REFERRER_LENGTH,
  MAX_USER_AGENT_LENGTH,
  VISITOR_HASH_LENGTH,
} from '../constants.js';

const UNKNOWN_COUNTRY_CODE = 'XX';

const truncate = (value, maxLength) => (value ? value.slice(0, maxLength) : null);

// Accepts ISO 3166-1 alpha-2 codes. Anything else, including "XX" (unknown), counts as no data.
export function normalizeCountry(value) {
  if (!value || !/^[A-Za-z]{2}$/.test(value)) return null;
  const code = value.toUpperCase();
  return code === UNKNOWN_COUNTRY_CODE ? null : code;
}

export function createClickTracker({
  publisher,
  visitorHashSecret,
  logger,
  metrics,
  now = () => new Date(),
  newId = randomUUID,
}) {
  // A keyed hash counts unique visitors without ever storing an IP address.
  function hashVisitor(ip, userAgent) {
    return createHmac('sha256', visitorHashSecret)
      .update(`${ip}|${userAgent}`)
      .digest('base64url')
      .slice(0, VISITOR_HASH_LENGTH);
  }

  function buildEvent(linkId, visit) {
    return {
      eventId: newId(),
      linkId,
      occurredAt: now().toISOString(),
      visitorHash: hashVisitor(visit.ip, visit.userAgent ?? ''),
      userAgent: truncate(visit.userAgent, MAX_USER_AGENT_LENGTH),
      referrer: truncate(visit.referrer, MAX_REFERRER_LENGTH),
      country: normalizeCountry(visit.country),
    };
  }

  function recordFailure(err) {
    metrics.clicksEnqueued.inc({ result: ClickEnqueueResult.ERROR });
    logger.warn({ err }, 'failed to enqueue click event');
  }

  // Fire-and-forget: analytics must never slow down or break a redirect, so this neither throws nor
  // returns a promise. Failures are logged and counted. `visit` is `{ ip, userAgent, referrer, country }`.
  function track(linkId, visit) {
    try {
      const event = buildEvent(linkId, visit);
      publisher.publish(event).then(
        () => metrics.clicksEnqueued.inc({ result: ClickEnqueueResult.OK }),
        (err) => recordFailure(err),
      );
    } catch (err) {
      recordFailure(err);
    }
  }

  return { track };
}
