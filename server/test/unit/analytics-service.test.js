import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnalyticsService } from '../../src/services/analytics.service.js';
import { createInMemoryLinkStore } from '../helpers/fakes.js';

const NOW = new Date('2026-06-15T12:00:00Z');
const DAY = 86_400_000;

const EMPTY_REPORT = {
  totals: { clicks: 0, uniqueVisitors: 0 },
  series: [],
  breakdowns: { countries: [], browsers: [], operatingSystems: [], devices: [], referrers: [] },
};

describe('AnalyticsService', () => {
  let store;
  let getReport;
  let service;

  beforeEach(async () => {
    store = createInMemoryLinkStore();
    await store.insert({
      code: 'mine',
      originalUrl: 'https://a.test/',
      userId: 'owner',
      expiresAt: null,
    });
    getReport = vi.fn(async () => EMPTY_REPORT);
    service = createAnalyticsService({ links: store, clicks: { getReport }, now: () => NOW });
  });

  it('defaults to the last 7 days in day buckets', async () => {
    const result = await service.getLinkAnalytics('mine', 'owner', {
      interval: 'day',
      includeBots: false,
    });

    expect(result.range).toEqual({
      from: new Date(NOW.getTime() - 7 * DAY),
      to: NOW,
      interval: 'day',
    });
    expect(getReport).toHaveBeenCalledWith(
      expect.objectContaining({ linkId: 1, includeBots: false }),
    );
  });

  it('passes an explicit range and the bots switch through', async () => {
    const from = new Date('2026-06-01T00:00:00Z');
    const to = new Date('2026-06-10T00:00:00Z');
    await service.getLinkAnalytics('mine', 'owner', {
      from,
      to,
      interval: 'day',
      includeBots: true,
    });

    expect(getReport).toHaveBeenCalledWith({
      linkId: 1,
      from,
      to,
      interval: 'day',
      includeBots: true,
    });
  });

  it("does not reveal other users' links, deleted links or missing links", async () => {
    await expect(
      service.getLinkAnalytics('mine', 'intruder', { interval: 'day', includeBots: false }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      service.getLinkAnalytics('missing', 'owner', { interval: 'day', includeBots: false }),
    ).rejects.toMatchObject({ statusCode: 404 });

    await store.softDelete('mine');
    await expect(
      service.getLinkAnalytics('mine', 'owner', { interval: 'day', includeBots: false }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(getReport).not.toHaveBeenCalled();
  });

  it('rejects an empty or inverted range', async () => {
    const from = new Date('2026-06-10T00:00:00Z');
    await expect(
      service.getLinkAnalytics('mine', 'owner', {
        from,
        to: from,
        interval: 'day',
        includeBots: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RANGE' });
    await expect(
      service.getLinkAnalytics('mine', 'owner', {
        from,
        to: new Date(from.getTime() - DAY),
        interval: 'day',
        includeBots: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RANGE' });
  });

  it('limits how many buckets one request may ask for', async () => {
    // 60 days of hourly buckets = 1441 > 1000; the same span in daily buckets is fine.
    const from = new Date(NOW.getTime() - 60 * DAY);
    await expect(
      service.getLinkAnalytics('mine', 'owner', {
        from,
        to: NOW,
        interval: 'hour',
        includeBots: false,
      }),
    ).rejects.toMatchObject({ code: 'RANGE_TOO_LARGE' });
    await expect(
      service.getLinkAnalytics('mine', 'owner', {
        from,
        to: NOW,
        interval: 'day',
        includeBots: false,
      }),
    ).resolves.toBeDefined();
  });
});
