import { CacheLookupResult, RedirectOutcome } from '../constants.js';
import { createSingleFlight } from '../utils/single-flight.js';
import { toRedirectTarget } from '../cache/link.cache.js';

// The redirect hot path: cache first, database only on a miss. Unknown codes are cached too, so
// scans over random codes are answered from Redis, and a burst of misses for one code runs a single
// query. Expiry is checked on every request, so a cache TTL never extends a link's life.
export function createLinkResolver({ links, cache, metrics, now = Date.now }) {
  const databaseLookupsInFlight = createSingleFlight();

  async function findTarget(code) {
    const cached = await cache.get(code);
    if (cached !== undefined) {
      const result = cached === null ? CacheLookupResult.NEGATIVE_HIT : CacheLookupResult.HIT;
      metrics.cacheLookups.inc({ result });
      return cached;
    }

    metrics.cacheLookups.inc({ result: CacheLookupResult.MISS });
    return databaseLookupsInFlight.run(code, async () => {
      const link = await links.findByCode(code);
      const target = link ? toRedirectTarget(link) : null;
      await cache.set(code, target);
      return target;
    });
  }

  // Resolves `{ outcome, target }`. `GONE` means the link existed but is disabled, deleted or expired.
  async function resolve(code) {
    const target = await findTarget(code);
    if (target === null) return { outcome: RedirectOutcome.NOT_FOUND };

    const isExpired = target.expiresAt !== null && Date.parse(target.expiresAt) <= now();
    if (!target.isActive || isExpired) return { outcome: RedirectOutcome.GONE };

    return { outcome: RedirectOutcome.REDIRECT, target };
  }

  return { resolve };
}
