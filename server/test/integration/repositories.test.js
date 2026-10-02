import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ClickRepository } from '../../src/modules/analytics/click.repository.js';
import { UserRepository } from '../../src/modules/auth/user.repository.js';
import { LinkRepository } from '../../src/modules/links/link.repository.js';
import { createTestContext, resetState } from '../helpers/context.js';

let ctx;
let links;
let clicks;
let users;

beforeAll(async () => {
  ctx = await createTestContext();
  links = new LinkRepository(ctx.container.pool);
  clicks = new ClickRepository(ctx.container.pool);
  users = new UserRepository(ctx.container.pool);
});
afterAll(() => ctx.close());
beforeEach(resetState);

const newLink = (code, extra = {}) =>
  links.insert({
    code,
    originalUrl: `https://dest.test/${code}`,
    userId: null,
    expiresAt: null,
    ...extra,
  });

const click = (linkId, overrides = {}) => ({
  eventId: randomUUID(),
  linkId,
  occurredAt: new Date('2026-06-01T12:00:00Z'),
  visitorHash: 'visitor-1',
  country: 'IN',
  referrerHost: null,
  browser: 'Chrome',
  os: 'macOS',
  deviceType: 'desktop',
  isBot: false,
  ...overrides,
});

describe('UserRepository', () => {
  it('enforces unique emails case-insensitively', async () => {
    expect(await users.create({ email: 'A@Example.com', passwordHash: 'h' })).not.toBeNull();
    expect(await users.create({ email: 'a@example.com', passwordHash: 'h' })).toBeNull();
  });

  it('finds users by email (any case) and by id', async () => {
    const created = await users.create({ email: 'a@example.com', passwordHash: 'h' });
    expect((await users.findByEmail('A@EXAMPLE.COM'))?.id).toBe(created?.id);
    expect((await users.findById(created?.id ?? ''))?.email).toBe('a@example.com');
    expect(await users.findByEmail('nobody@example.com')).toBeNull();
  });
});

describe('LinkRepository', () => {
  it('inserts a link with defaults', async () => {
    const link = await newLink('abc1234');
    expect(link).toMatchObject({
      code: 'abc1234',
      originalUrl: 'https://dest.test/abc1234',
      isActive: true,
      clickCount: 0,
      expiresAt: null,
      deletedAt: null,
    });
    expect(typeof link?.id).toBe('number');
  });

  it('reports a duplicate code as null instead of throwing', async () => {
    await newLink('dup');
    expect(await newLink('dup')).toBeNull();
  });

  it('treats codes as case-sensitive', async () => {
    expect(await newLink('Abc')).not.toBeNull();
    expect(await newLink('abc')).not.toBeNull();
  });

  it('rejects malformed codes at the database level', async () => {
    await expect(newLink('no spaces')).rejects.toThrow(/links_code_format/);
    await expect(newLink('ab')).rejects.toThrow(/links_code_format/);
  });

  it('finds links by code, including deleted ones', async () => {
    await newLink('find-me');
    await links.softDelete('find-me');
    expect((await links.findByCode('find-me'))?.deletedAt).toBeInstanceOf(Date);
    expect(await links.findByCode('unknown')).toBeNull();
  });

  it('updates only the provided fields and bumps updated_at', async () => {
    const before = await newLink('upd', { expiresAt: new Date('2030-01-01T00:00:00Z') });
    const after = await links.update('upd', { isActive: false });

    expect(after).toMatchObject({ isActive: false, originalUrl: before?.originalUrl });
    expect(after?.expiresAt).toEqual(before?.expiresAt);
    expect(after?.updatedAt.getTime()).toBeGreaterThanOrEqual(before?.updatedAt.getTime() ?? 0);
  });

  it('can clear an expiry with null', async () => {
    await newLink('exp', { expiresAt: new Date('2030-01-01T00:00:00Z') });
    expect((await links.update('exp', { expiresAt: null }))?.expiresAt).toBeNull();
  });

  it('does not update deleted or unknown links', async () => {
    await newLink('del');
    await links.softDelete('del');
    expect(await links.update('del', { isActive: false })).toBeNull();
    expect(await links.update('unknown', { isActive: false })).toBeNull();
  });

  it('soft-deletes exactly once', async () => {
    await newLink('once');
    expect(await links.softDelete('once')).toBe(true);
    expect(await links.softDelete('once')).toBe(false);
    expect(await links.softDelete('unknown')).toBe(false);
  });

  describe('listByUser', () => {
    let owner;
    let other;

    beforeEach(async () => {
      owner = (await users.create({ email: 'owner@example.com', passwordHash: 'h' }))?.id ?? '';
      other = (await users.create({ email: 'other@example.com', passwordHash: 'h' }))?.id ?? '';
      for (let i = 1; i <= 5; i++) await newLink(`own-${i}`, { userId: owner });
      await newLink('theirs', { userId: other });
      await newLink('anon');
    });

    it("returns only the user's links, newest first", async () => {
      const rows = await links.listByUser({ userId: owner, limit: 50 });
      expect(rows.map((l) => l.code)).toEqual(['own-5', 'own-4', 'own-3', 'own-2', 'own-1']);
    });

    it('pages with a keyset cursor and no overlap', async () => {
      const first = await links.listByUser({ userId: owner, limit: 2 });
      const second = await links.listByUser({
        userId: owner,
        limit: 2,
        beforeId: first.at(-1)?.id,
      });
      const third = await links.listByUser({
        userId: owner,
        limit: 2,
        beforeId: second.at(-1)?.id,
      });

      expect([...first, ...second, ...third].map((l) => l.code)).toEqual([
        'own-5',
        'own-4',
        'own-3',
        'own-2',
        'own-1',
      ]);
    });

    it('excludes deleted links', async () => {
      await links.softDelete('own-3');
      const codes = (await links.listByUser({ userId: owner, limit: 50 })).map((l) => l.code);
      expect(codes).not.toContain('own-3');
    });

    it('searches code and destination, treating wildcards literally', async () => {
      await newLink('percent-x', { userId: owner, originalUrl: 'https://dest.test/100%25-off' });

      const byCode = await links.listByUser({ userId: owner, limit: 50, search: 'OWN-2' });
      expect(byCode.map((l) => l.code)).toEqual(['own-2']);

      const wildcard = await links.listByUser({ userId: owner, limit: 50, search: '%' });
      expect(wildcard.map((l) => l.code)).toEqual(['percent-x']);

      const underscore = await links.listByUser({ userId: owner, limit: 50, search: 'own_1' });
      expect(underscore).toEqual([]);
    });
  });
});

describe('ClickRepository.insertBatch', () => {
  it('stores clicks and increments the counter for human clicks only', async () => {
    const link = await newLink('clk-1');
    const id = link?.id ?? 0;

    const inserted = await clicks.insertBatch([
      click(id),
      click(id),
      click(id, { isBot: true, browser: null, deviceType: 'unknown' }),
    ]);

    expect(inserted).toBe(3);
    expect((await links.findByCode('clk-1'))?.clickCount).toBe(2);
    const { rows } = await ctx.container.pool.query('SELECT count(*)::int AS n FROM clicks');
    expect(rows[0].n).toBe(3);
  });

  it('is idempotent: replaying the same events changes nothing', async () => {
    const id = (await newLink('clk-2'))?.id ?? 0;
    const batch = [click(id), click(id)];

    expect(await clicks.insertBatch(batch)).toBe(2);
    expect(await clicks.insertBatch(batch)).toBe(0);
    expect(await clicks.insertBatch([...batch, click(id)])).toBe(1);

    expect((await links.findByCode('clk-2'))?.clickCount).toBe(3);
  });

  it('spreads counts across links in one batch', async () => {
    const a = (await newLink('aaa-1'))?.id ?? 0;
    const b = (await newLink('bbb-1'))?.id ?? 0;

    await clicks.insertBatch([click(a), click(b), click(b), click(b)]);

    expect((await links.findByCode('aaa-1'))?.clickCount).toBe(1);
    expect((await links.findByCode('bbb-1'))?.clickCount).toBe(3);
  });

  it('silently skips events for links that do not exist', async () => {
    const id = (await newLink('clk-3'))?.id ?? 0;
    expect(await clicks.insertBatch([click(id), click(999_999)])).toBe(1);
  });

  it('handles an empty batch and preserves nullable fields', async () => {
    expect(await clicks.insertBatch([])).toBe(0);

    const id = (await newLink('clk-4'))?.id ?? 0;
    await clicks.insertBatch([
      click(id, { country: null, browser: null, os: null, referrerHost: null }),
    ]);
    const { rows } = await ctx.container.pool.query(
      'SELECT country, browser, os, referrer_host FROM clicks',
    );
    expect(rows[0]).toEqual({ country: null, browser: null, os: null, referrer_host: null });
  });
});

describe('ClickRepository.getReport', () => {
  const at = (iso) => new Date(iso);
  let linkId;

  beforeEach(async () => {
    linkId = (await newLink('rep'))?.id ?? 0;
    await clicks.insertBatch([
      click(linkId, {
        occurredAt: at('2026-06-01T10:00:00Z'),
        visitorHash: 'v1',
        country: 'IN',
        browser: 'Chrome',
        os: 'Windows',
        deviceType: 'desktop',
        referrerHost: 'news.com',
      }),
      click(linkId, {
        occurredAt: at('2026-06-01T23:59:59Z'),
        visitorHash: 'v2',
        country: 'US',
        browser: 'Safari',
        os: 'iOS',
        deviceType: 'mobile',
        referrerHost: 'news.com',
      }),
      click(linkId, {
        occurredAt: at('2026-06-03T00:00:00Z'),
        visitorHash: 'v1',
        country: 'IN',
        browser: 'Chrome',
        os: 'Windows',
        deviceType: 'desktop',
        referrerHost: null,
      }),
      click(linkId, {
        occurredAt: at('2026-06-03T05:00:00Z'),
        visitorHash: 'bot',
        country: null,
        browser: null,
        os: null,
        deviceType: 'unknown',
        isBot: true,
      }),
    ]);
  });

  const range = { from: at('2026-06-01T00:00:00Z'), to: at('2026-06-04T00:00:00Z') };

  it('returns totals, excluding bots by default', async () => {
    const report = await clicks.getReport({
      linkId,
      ...range,
      interval: 'day',
      includeBots: false,
    });
    expect(report.totals).toEqual({ clicks: 3, uniqueVisitors: 2 });

    const withBots = await clicks.getReport({
      linkId,
      ...range,
      interval: 'day',
      includeBots: true,
    });
    expect(withBots.totals).toEqual({ clicks: 4, uniqueVisitors: 3 });
  });

  it('fills empty days with zero and buckets on UTC day boundaries', async () => {
    const { series } = await clicks.getReport({
      linkId,
      ...range,
      interval: 'day',
      includeBots: false,
    });

    expect(series.map((p) => [p.bucket.toISOString(), p.clicks])).toEqual([
      ['2026-06-01T00:00:00.000Z', 2],
      ['2026-06-02T00:00:00.000Z', 0],
      ['2026-06-03T00:00:00.000Z', 1],
    ]);
  });

  it('supports hourly buckets', async () => {
    const { series } = await clicks.getReport({
      linkId,
      from: at('2026-06-01T09:00:00Z'),
      to: at('2026-06-01T12:00:00Z'),
      interval: 'hour',
      includeBots: false,
    });
    expect(series.map((p) => p.clicks)).toEqual([0, 1, 0]);
  });

  it('treats the range as [from, to): the end is exclusive', async () => {
    const report = await clicks.getReport({
      linkId,
      from: at('2026-06-01T00:00:00Z'),
      to: at('2026-06-03T00:00:00Z'), // a click sits exactly here
      interval: 'day',
      includeBots: false,
    });
    expect(report.totals.clicks).toBe(2);
    expect(report.series).toHaveLength(2);
  });

  it('aggregates every breakdown, ranked by clicks, with friendly labels for missing data', async () => {
    const { breakdowns } = await clicks.getReport({
      linkId,
      ...range,
      interval: 'day',
      includeBots: true,
    });

    expect(breakdowns.countries[0]).toEqual({ label: 'IN', clicks: 2 });
    // Ties are ordered by label; the exact order depends on the database collation.
    expect(breakdowns.countries.slice(1)).toHaveLength(2);
    expect(breakdowns.countries.slice(1)).toEqual(
      expect.arrayContaining([
        { label: 'Unknown', clicks: 1 },
        { label: 'US', clicks: 1 },
      ]),
    );
    expect(breakdowns.browsers[0]).toEqual({ label: 'Chrome', clicks: 2 });
    expect(breakdowns.operatingSystems.map((e) => e.label)).toContain('iOS');
    expect(breakdowns.devices[0]).toEqual({ label: 'desktop', clicks: 2 });
    expect(breakdowns.referrers).toHaveLength(2);
    expect(breakdowns.referrers).toEqual(
      expect.arrayContaining([
        { label: 'Direct', clicks: 2 },
        { label: 'news.com', clicks: 2 },
      ]),
    );
  });

  it('caps each breakdown at ten entries', async () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      click(linkId, {
        occurredAt: at('2026-06-02T10:00:00Z'),
        country: `C${String.fromCharCode(65 + i)}`,
      }),
    );
    await clicks.insertBatch(many);

    const { breakdowns } = await clicks.getReport({
      linkId,
      ...range,
      interval: 'day',
      includeBots: false,
    });
    expect(breakdowns.countries).toHaveLength(10);
  });

  it('is empty, not an error, for a link with no clicks', async () => {
    const other = (await newLink('quiet'))?.id ?? 0;
    const report = await clicks.getReport({
      linkId: other,
      ...range,
      interval: 'day',
      includeBots: false,
    });

    expect(report.totals).toEqual({ clicks: 0, uniqueVisitors: 0 });
    expect(report.series.every((p) => p.clicks === 0)).toBe(true);
    expect(report.breakdowns.countries).toEqual([]);
  });

  it('keeps links separate', async () => {
    const other = (await newLink('other'))?.id ?? 0;
    await clicks.insertBatch([click(other, { occurredAt: at('2026-06-02T10:00:00Z') })]);

    const report = await clicks.getReport({ linkId, ...range, interval: 'day', includeBots: true });
    expect(report.totals.clicks).toBe(4);
  });
});
