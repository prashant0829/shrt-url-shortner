import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLink,
  createTestContext,
  drainClicks,
  resetState,
  signUp,
} from '../helpers/context.js';

let ctx;

let owner;

const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bots.html)';

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await resetState();
  owner = await signUp(ctx.app);
});

const analytics = (code, query = '', headers = owner.headers) =>
  ctx.app.inject({ method: 'GET', url: `/api/v1/links/${code}/analytics${query}`, headers });

const click = (code, headers, remoteAddress) =>
  ctx.app.inject({ method: 'GET', url: `/${code}`, headers, remoteAddress });

const waitForQueued = (count) =>
  vi.waitFor(async () =>
    expect(await ctx.dependencies.redis.xlen(ctx.config.clicks.streamKey)).toBe(count),
  );

describe('GET /api/v1/links/:code/analytics', () => {
  it('reports clicks that travelled through the whole pipeline', async () => {
    const { code } = await createLink(ctx.app, owner.headers, {
      url: 'https://example.com',
      customAlias: 'stats-demo',
    });

    // Two people (distinct IPs) on desktop/mobile, one of them clicking twice, plus a crawler.
    await click(
      code,
      { 'user-agent': CHROME_WIN, 'cf-ipcountry': 'IN', referer: 'https://news.ycombinator.com/x' },
      '203.0.113.10',
    );
    await click(code, { 'user-agent': CHROME_WIN, 'cf-ipcountry': 'IN' }, '203.0.113.10');
    await click(
      code,
      {
        'user-agent': SAFARI_IPHONE,
        'cf-ipcountry': 'US',
        referer: 'https://www.google.com/search',
      },
      '203.0.113.20',
    );
    await click(code, { 'user-agent': GOOGLEBOT }, '66.249.66.1');
    await waitForQueued(4);
    await drainClicks(ctx.dependencies);

    const res = await analytics(code);
    expect(res.statusCode).toBe(200);
    const report = res.json();

    expect(report.code).toBe('stats-demo');
    expect(report.totals).toEqual({ clicks: 3, uniqueVisitors: 2 }); // the crawler is excluded
    expect(report.breakdowns.countries).toEqual(
      expect.arrayContaining([
        { label: 'IN', clicks: 2 },
        { label: 'US', clicks: 1 },
      ]),
    );
    expect(report.breakdowns.browsers).toEqual(
      expect.arrayContaining([
        { label: 'Chrome', clicks: 2 },
        { label: 'Safari', clicks: 1 },
      ]),
    );
    expect(report.breakdowns.operatingSystems).toEqual(
      expect.arrayContaining([
        { label: 'Windows', clicks: 2 },
        { label: 'iOS', clicks: 1 },
      ]),
    );
    expect(report.breakdowns.devices).toEqual(
      expect.arrayContaining([
        { label: 'desktop', clicks: 2 },
        { label: 'mobile', clicks: 1 },
      ]),
    );
    expect(report.breakdowns.referrers).toEqual(
      expect.arrayContaining([
        { label: 'Direct', clicks: 1 },
        { label: 'news.ycombinator.com', clicks: 1 },
        { label: 'google.com', clicks: 1 },
      ]),
    );

    const today = report.series.at(-1);
    expect(today.clicks).toBe(3);
    expect(report.series).toHaveLength(8); // 7 days back plus today, empty days included
    expect(report.series.slice(0, -1).every((p) => p.clicks === 0)).toBe(true);

    const link = (
      await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/links/stats-demo',
        headers: owner.headers,
      })
    ).json();
    expect(link.clickCount).toBe(3);
  });

  it('includes crawlers on request', async () => {
    const { code } = await createLink(ctx.app, owner.headers, { url: 'https://example.com' });
    await click(code, { 'user-agent': CHROME_WIN }, '203.0.113.10');
    await click(code, { 'user-agent': GOOGLEBOT }, '66.249.66.1');
    await waitForQueued(2);
    await drainClicks(ctx.dependencies);

    expect((await analytics(code, '?includeBots=true')).json().totals.clicks).toBe(2);
    expect((await analytics(code, '?includeBots=false')).json().totals.clicks).toBe(1);
  });

  it('supports hourly buckets over a custom range', async () => {
    const { code } = await createLink(ctx.app, owner.headers, { url: 'https://example.com' });
    const to = new Date();
    const from = new Date(to.getTime() - 5 * 3_600_000);

    const res = await analytics(
      code,
      `?interval=hour&from=${from.toISOString()}&to=${to.toISOString()}`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.json().range.interval).toBe('hour');
    expect(res.json().series.length).toBeGreaterThanOrEqual(5);
  });

  it('is empty for a link nobody has visited', async () => {
    const { code } = await createLink(ctx.app, owner.headers, { url: 'https://example.com' });
    const report = (await analytics(code)).json();

    expect(report.totals).toEqual({ clicks: 0, uniqueVisitors: 0 });
    expect(report.breakdowns.countries).toEqual([]);
  });

  it('validates the range and interval', async () => {
    const { code } = await createLink(ctx.app, owner.headers, { url: 'https://example.com' });
    const now = new Date();

    const inverted = await analytics(
      code,
      `?from=${now.toISOString()}&to=${new Date(now.getTime() - 1000).toISOString()}`,
    );
    expect(inverted.statusCode).toBe(400);
    expect(inverted.json().error.code).toBe('INVALID_RANGE');

    const huge = await analytics(
      code,
      `?interval=hour&from=${new Date(now.getTime() - 90 * 86_400_000).toISOString()}`,
    );
    expect(huge.statusCode).toBe(400);
    expect(huge.json().error.code).toBe('RANGE_TOO_LARGE');

    expect((await analytics(code, '?interval=minute')).statusCode).toBe(400);
    expect((await analytics(code, '?from=yesterday')).statusCode).toBe(400);
  });

  it('is private to the link owner', async () => {
    const { code } = await createLink(ctx.app, owner.headers, { url: 'https://example.com' });
    const stranger = await signUp(ctx.app);

    expect((await analytics(code, '', {})).statusCode).toBe(401);
    expect((await analytics(code, '', stranger.headers)).statusCode).toBe(404);
    expect((await analytics('no-such-link')).statusCode).toBe(404);

    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/links/${code}`,
      headers: owner.headers,
    });
    expect((await analytics(code)).statusCode).toBe(404);
  });
});
