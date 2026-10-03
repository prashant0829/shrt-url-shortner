import { describe, expect, it, vi } from 'vitest';
import { createMetrics } from '../../src/infra/metrics.js';
import { enrichClick } from '../../src/utils/click-enricher.js';
import { createClickTracker, normalizeCountry } from '../../src/services/click-tracker.service.js';
import { createLogger } from '../../src/infra/logger.js';
import { counterValue } from '../helpers/fakes.js';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DESKTOP_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bots.html)';

const event = (overrides = {}) => ({
  eventId: '0b0cbd6c-6e7a-4b58-bd0c-5c3d5d2d2c11',
  linkId: 7,
  occurredAt: '2026-06-01T12:00:00.000Z',
  visitorHash: 'hash',
  userAgent: DESKTOP_CHROME,
  referrer: null,
  country: null,
  ...overrides,
});

describe('enrichClick', () => {
  it('classifies a mobile browser', () => {
    expect(enrichClick(event({ userAgent: IPHONE_SAFARI }))).toMatchObject({
      browser: 'Safari',
      os: 'iOS',
      deviceType: 'mobile',
      isBot: false,
    });
  });

  it('classifies a desktop browser', () => {
    expect(enrichClick(event())).toMatchObject({
      browser: 'Chrome',
      os: 'Windows',
      deviceType: 'desktop',
      isBot: false,
    });
  });

  it('flags crawlers as bots', () => {
    expect(enrichClick(event({ userAgent: GOOGLEBOT })).isBot).toBe(true);
  });

  it('treats a missing user agent as automation with unknown device data', () => {
    expect(enrichClick(event({ userAgent: null }))).toMatchObject({
      isBot: true,
      browser: null,
      os: null,
      deviceType: 'unknown',
    });
  });

  it.each([
    ['https://www.Google.com/search?q=secret', 'google.com'],
    ['https://news.ycombinator.com/item?id=1', 'news.ycombinator.com'],
    ['android-app://com.google.android.gm', null],
    ['not a url', null],
    [null, null],
  ])('keeps only the referrer host: %s -> %s', (referrer, expected) => {
    expect(enrichClick(event({ referrer })).referrerHost).toBe(expected);
  });

  it('converts the timestamp to a Date and passes identifiers through', () => {
    const result = enrichClick(event({ country: 'IN' }));
    expect(result.occurredAt).toEqual(new Date('2026-06-01T12:00:00.000Z'));
    expect(result).toMatchObject({
      eventId: '0b0cbd6c-6e7a-4b58-bd0c-5c3d5d2d2c11',
      linkId: 7,
      country: 'IN',
    });
  });
});

describe('normalizeCountry', () => {
  it.each([
    ['in', 'IN'],
    ['US', 'US'],
    ['XX', null], // Cloudflare: unknown
    ['T1', null], // Cloudflare: Tor
    ['USA', null],
    ['', null],
    [undefined, null],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeCountry(input)).toBe(expected);
  });
});

describe('ClickTracker', () => {
  const logger = createLogger({ env: 'test', log: { level: 'silent' } });

  const build = (publisher) => {
    const metrics = createMetrics();
    const tracker = createClickTracker({
      publisher,
      visitorHashSecret: 'test-secret-1234567',
      logger,
      metrics,
      now: () => new Date('2026-06-01T12:00:00Z'),
      newId: () => 'fixed-id',
    });
    return { tracker, metrics };
  };

  it('publishes an event without ever including the raw IP address', async () => {
    const publish = vi.fn(async () => undefined);
    const { tracker, metrics } = build({ publish });

    tracker.track(9, {
      ip: '203.0.113.42',
      userAgent: DESKTOP_CHROME,
      referrer: 'https://example.com/a',
      country: 'de',
    });

    expect(publish).toHaveBeenCalledOnce();
    const published = publish.mock.calls[0][0];
    expect(published).toMatchObject({
      eventId: 'fixed-id',
      linkId: 9,
      occurredAt: '2026-06-01T12:00:00.000Z',
      userAgent: DESKTOP_CHROME,
      referrer: 'https://example.com/a',
      country: 'DE',
    });
    expect(JSON.stringify(published)).not.toContain('203.0.113.42');

    await vi.waitFor(async () =>
      expect(await counterValue(metrics.clicksEnqueued, { result: 'ok' })).toBe(1),
    );
  });

  it('derives the same visitor hash for the same visitor and a different one otherwise', () => {
    const seen = [];
    const { tracker } = build({
      publish: async (e) => {
        seen.push(e.visitorHash);
      },
    });

    tracker.track(1, { ip: '1.1.1.1', userAgent: 'A' });
    tracker.track(2, { ip: '1.1.1.1', userAgent: 'A' });
    tracker.track(1, { ip: '2.2.2.2', userAgent: 'A' });
    tracker.track(1, { ip: '1.1.1.1', userAgent: 'B' });

    expect(seen[0]).toBe(seen[1]);
    expect(new Set(seen).size).toBe(3);
  });

  it('truncates oversized headers', () => {
    const publish = vi.fn(async () => undefined);
    const { tracker } = build({ publish });

    tracker.track(1, { ip: '1.1.1.1', userAgent: 'u'.repeat(2000), referrer: 'r'.repeat(5000) });

    const published = publish.mock.calls[0][0];
    expect(published.userAgent).toHaveLength(512);
    expect(published.referrer).toHaveLength(2048);
  });

  it('swallows and counts publisher failures so a redirect can never fail because of analytics', async () => {
    const { tracker, metrics } = build({
      publish: async () => {
        throw new Error('redis is down');
      },
    });

    expect(() => tracker.track(1, { ip: '1.1.1.1' })).not.toThrow();
    await vi.waitFor(async () =>
      expect(await counterValue(metrics.clicksEnqueued, { result: 'error' })).toBe(1),
    );
  });

  it('also survives a publisher that throws synchronously', async () => {
    const { tracker, metrics } = build({
      publish: () => {
        throw new Error('sync failure');
      },
    });

    expect(() => tracker.track(1, { ip: '1.1.1.1' })).not.toThrow();
    expect(await counterValue(metrics.clicksEnqueued, { result: 'error' })).toBe(1);
  });
});
