import { createHmac, randomUUID } from 'node:crypto';

/**
 * Request facts the redirect route hands over; deliberately framework-agnostic.
 * @typedef {object} ClickContext
 * @property {string} ip
 * @property {string} [userAgent]
 * @property {string} [referrer]
 * @property {string} [country]
 */

/**
 * @typedef {object} ClickTrackerDeps
 * @property {import('./click-events.js').ClickPublisher} publisher
 * @property {string} visitorHashSecret
 * @property {import('pino').Logger} logger
 * @property {{clicksEnqueued: {inc: (labels: {result: string}) => void}}} metrics
 * @property {() => Date} [now]
 * @property {() => string} [newId]
 */

export class ClickTracker {
  #now;
  #newId;
  #deps;

  /** @param {ClickTrackerDeps} deps */
  constructor(deps) {
    this.#deps = deps;

    this.#now = deps.now ?? (() => new Date());
    this.#newId = deps.newId ?? randomUUID;
  }

  /**
   * Fire-and-forget: analytics must never slow down or break a redirect, so this neither
   * throws nor returns a promise. Failures are logged and counted.
   */
  /**
   * @param {number} linkId
   * @param {ClickContext} context
   */
  track(linkId, context) {
    try {
      const event = this.#buildEvent(linkId, context);
      this.#deps.publisher.publish(event).then(
        () => this.#deps.metrics.clicksEnqueued.inc({ result: 'ok' }),
        (err) => this.#recordFailure(err),
      );
    } catch (err) {
      this.#recordFailure(err);
    }
  }

  #buildEvent(linkId, context) {
    return {
      eventId: this.#newId(),
      linkId,
      occurredAt: this.#now().toISOString(),
      visitorHash: this.#hashVisitor(context.ip, context.userAgent ?? ''),
      userAgent: truncate(context.userAgent, 512),
      referrer: truncate(context.referrer, 2048),
      country: normalizeCountry(context.country),
    };
  }

  /** Keyed hash: counts unique visitors without ever storing an IP address. */
  #hashVisitor(ip, userAgent) {
    return createHmac('sha256', this.#deps.visitorHashSecret)
      .update(`${ip}|${userAgent}`)
      .digest('base64url')
      .slice(0, 22);
  }

  #recordFailure(err) {
    this.#deps.metrics.clicksEnqueued.inc({ result: 'error' });
    this.#deps.logger.warn({ err }, 'failed to enqueue click event');
  }
}

const truncate = (value, max) => (value ? value.slice(0, max) : null);

/** Accepts ISO 3166-1 alpha-2 codes; "XX" (unknown) and "T1" (Tor) are treated as no data. */
export function normalizeCountry(value) {
  if (!value || !/^[A-Za-z]{2}$/.test(value)) return null;
  const code = value.toUpperCase();
  return code === 'XX' ? null : code;
}
