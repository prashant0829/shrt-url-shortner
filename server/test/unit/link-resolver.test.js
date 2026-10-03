import { beforeEach, describe, expect, it } from 'vitest';
import { createMetrics } from '../../src/infra/metrics.js';
import { createLinkResolver } from '../../src/services/link-resolver.service.js';
import { toRedirectTarget } from '../../src/cache/link.cache.js';
import {
  createInMemoryLinkCache,
  createInMemoryLinkStore,
  counterValue,
} from '../helpers/fakes.js';

const NOW = Date.parse('2026-06-01T12:00:00Z');

describe('LinkResolver', () => {
  let store;
  let cache;
  let metrics;

  const resolver = (overrides = {}) =>
    createLinkResolver({ links: store, cache: overrides.cache ?? cache, metrics, now: () => NOW });

  const addLink = (code, patch = {}) =>
    store
      .insert({
        code,
        originalUrl: `https://dest.test/${code}`,
        userId: null,
        expiresAt: patch.expiresAt ?? null,
      })
      .then(async (link) => {
        if (link && patch.isActive === false) await store.update(code, { isActive: false });
        return link;
      });

  beforeEach(() => {
    store = createInMemoryLinkStore();
    cache = createInMemoryLinkCache();
    metrics = createMetrics();
  });

  it('answers from the database on a miss, then from the cache', async () => {
    await addLink('abc');
    const r = resolver();

    expect(await r.resolve('abc')).toMatchObject({
      outcome: 'redirect',
      target: { url: 'https://dest.test/abc' },
    });
    expect(await r.resolve('abc')).toMatchObject({ outcome: 'redirect' });

    expect(store.findCalls).toBe(1);
    expect(await counterValue(metrics.cacheLookups, { result: 'miss' })).toBe(1);
    expect(await counterValue(metrics.cacheLookups, { result: 'hit' })).toBe(1);
  });

  it('caches unknown codes so repeated probes never reach the database', async () => {
    const r = resolver();

    expect(await r.resolve('nope')).toEqual({ outcome: 'not_found' });
    expect(await r.resolve('nope')).toEqual({ outcome: 'not_found' });

    expect(store.findCalls).toBe(1);
    expect(cache.entries.get('nope')).toBeNull();
    expect(await counterValue(metrics.cacheLookups, { result: 'negative_hit' })).toBe(1);
  });

  it('collapses a burst of concurrent misses into one database query', async () => {
    await addLink('hot');
    const r = resolver();

    const results = await Promise.all(Array.from({ length: 50 }, () => r.resolve('hot')));

    expect(results.every((res) => res.outcome === 'redirect')).toBe(true);
    expect(store.findCalls).toBe(1);
  });

  it('reports expired links as gone, even when the cached entry is still fresh', async () => {
    await addLink('exp', { expiresAt: new Date(NOW - 1_000) });
    const r = resolver();

    expect(await r.resolve('exp')).toEqual({ outcome: 'gone' });
    expect(await r.resolve('exp')).toEqual({ outcome: 'gone' }); // served from cache, same answer
    expect(store.findCalls).toBe(1);
  });

  it('honours an expiry that passes while the entry sits in the cache', async () => {
    const target = {
      linkId: 1,
      url: 'https://x.test/',
      expiresAt: new Date(NOW + 5_000).toISOString(),
      isActive: true,
    };
    cache.entries.set('soon', target);

    expect((await resolver().resolve('soon')).outcome).toBe('redirect');
    const later = createLinkResolver({ links: store, cache, metrics, now: () => NOW + 5_000 });
    expect((await later.resolve('soon')).outcome).toBe('gone');
  });

  it('reports disabled links as gone', async () => {
    await addLink('off', { isActive: false });
    expect(await resolver().resolve('off')).toEqual({ outcome: 'gone' });
  });

  it('reports soft-deleted links as gone rather than not found', async () => {
    await addLink('deleted');
    await store.softDelete('deleted');
    expect(await resolver().resolve('deleted')).toEqual({ outcome: 'gone' });
  });

  it('keeps working when the cache is unavailable', async () => {
    await addLink('abc');
    const brokenCache = {
      get: async () => undefined, // adapters swallow errors and report a miss
      set: async () => undefined,
      delete: async () => undefined,
    };
    const r = resolver({ cache: brokenCache });

    expect((await r.resolve('abc')).outcome).toBe('redirect');
    expect((await r.resolve('abc')).outcome).toBe('redirect');
    expect(store.findCalls).toBe(2); // every request falls through to the database
  });

  it('maps stored links to cacheable targets', async () => {
    const link = await addLink('map');
    expect(link && toRedirectTarget(link)).toEqual({
      linkId: link?.id,
      url: 'https://dest.test/map',
      expiresAt: null,
      isActive: true,
    });
  });
});
