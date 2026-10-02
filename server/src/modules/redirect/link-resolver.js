import { SingleFlight } from '../../shared/single-flight.js';
import { toLinkTarget } from '../links/link.mapper.js';

/**
 * @typedef {{status: 'redirect', target: import('../links/link.cache.js').LinkTarget}
 *   | {status: 'gone'}
 *   | {status: 'not_found'}} Resolution
 * `gone` means the link existed but is disabled, deleted or expired.
 */

/**
 * @typedef {object} LinkResolverDeps
 * @property {Pick<import('../links/link.repository.js').LinkStore, 'findByCode'>} links
 * @property {import('../links/link.cache.js').LinkCache} cache
 * @property {{cacheLookups: {inc: (labels: {result: string}) => void}}} metrics
 * @property {() => number} [now]
 */

/**
 * The redirect hot path. Cache-aside with two protections for the database:
 *  - negative caching, so scans over random codes are answered from Redis;
 *  - single-flight, so a burst of misses for one code causes one query.
 * Expiry is evaluated per request against the cached row, so cache TTLs never extend a link's life.
 */
export class LinkResolver {
  #misses = new SingleFlight();
  #now;
  #deps;

  /** @param {LinkResolverDeps} deps */
  constructor(deps) {
    this.#deps = deps;

    this.#now = deps.now ?? Date.now;
  }

  /** @returns {Promise<Resolution>} */
  async resolve(code) {
    const target = await this.#lookup(code);
    if (target === null) return { status: 'not_found' };

    const expired = target.expiresAt !== null && Date.parse(target.expiresAt) <= this.#now();
    if (!target.isActive || expired) return { status: 'gone' };

    return { status: 'redirect', target };
  }

  async #lookup(code) {
    const { cache, links, metrics } = this.#deps;

    const cached = await cache.get(code);
    if (cached !== undefined) {
      metrics.cacheLookups.inc({ result: cached === null ? 'negative_hit' : 'hit' });
      return cached;
    }

    metrics.cacheLookups.inc({ result: 'miss' });
    return this.#misses.run(code, async () => {
      const link = await links.findByCode(code);
      const target = link ? toLinkTarget(link) : null;
      await cache.set(code, target);
      return target;
    });
  }
}
