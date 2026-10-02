import { BadRequestError, NotFoundError } from '../../shared/errors.js';

/**
 * @typedef {object} AnalyticsQuery
 * @property {Date} [from] Defaults to seven days before `to`.
 * @property {Date} [to] Defaults to now.
 * @property {import('./click.repository.js').Interval} interval
 * @property {boolean} includeBots
 */

/**
 * @typedef {import('./click.repository.js').ClickReport & {
 *   code: string,
 *   range: {from: Date, to: Date, interval: import('./click.repository.js').Interval}
 * }} LinkAnalytics
 */

/**
 * @typedef {object} AnalyticsServiceDeps
 * @property {Pick<import('../links/link.repository.js').LinkStore, 'findByCode'>} links
 * @property {import('./click.repository.js').ClickReader} clicks
 * @property {() => Date} [now]
 */

/** Bounds the work a single analytics request can trigger. */
const MAX_BUCKETS = 1_000;
const DEFAULT_RANGE_MS = 7 * 24 * 60 * 60 * 1000;
const INTERVAL_MS = { hour: 3_600_000, day: 86_400_000 };

export class AnalyticsService {
  #now;
  #deps;

  /** @param {AnalyticsServiceDeps} deps */
  constructor(deps) {
    this.#deps = deps;

    this.#now = deps.now ?? (() => new Date());
  }

  /**
   * @param {string} code
   * @param {string} userId
   * @param {AnalyticsQuery} query
   * @returns {Promise<LinkAnalytics>}
   */
  async getLinkAnalytics(code, userId, query) {
    const link = await this.#deps.links.findByCode(code);
    if (!link || link.deletedAt !== null || link.userId !== userId) {
      throw new NotFoundError('LINK_NOT_FOUND', 'Link not found');
    }

    const to = query.to ?? this.#now();
    const from = query.from ?? new Date(to.getTime() - DEFAULT_RANGE_MS);
    this.#assertRange(from, to, query.interval);

    const report = await this.#deps.clicks.getReport({
      linkId: link.id,
      from,
      to,
      interval: query.interval,
      includeBots: query.includeBots,
    });
    return { code, range: { from, to, interval: query.interval }, ...report };
  }

  #assertRange(from, to, interval) {
    if (from.getTime() >= to.getTime()) {
      throw new BadRequestError('INVALID_RANGE', '`from` must be earlier than `to`');
    }
    const buckets = Math.ceil((to.getTime() - from.getTime()) / INTERVAL_MS[interval]) + 1;
    if (buckets > MAX_BUCKETS) {
      throw new BadRequestError(
        'RANGE_TOO_LARGE',
        `The range would produce ${buckets} ${interval} buckets; the maximum is ${MAX_BUCKETS}`,
      );
    }
  }
}
