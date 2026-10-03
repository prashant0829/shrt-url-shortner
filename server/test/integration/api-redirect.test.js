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

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await resetState();
  owner = await signUp(ctx.app);
});

const visit = (code, headers = {}, method = 'GET') =>
  ctx.app.inject({ method, url: `/${code}`, headers });

const streamKey = () => ctx.config.clicks.streamKey;

const queuedEvents = async () =>
  (await ctx.dependencies.redis.xrange(streamKey(), '-', '+')).map(([, fields]) =>
    JSON.parse(fields[1]),
  );

/** Click tracking is fire-and-forget, so wait for the event to reach the stream. */
const waitForQueued = (count) =>
  vi.waitFor(async () => expect(await ctx.dependencies.redis.xlen(streamKey())).toBe(count));

const patch = (code, payload) =>
  ctx.app.inject({
    method: 'PATCH',
    url: `/api/v1/links/${code}`,
    headers: owner.headers,
    payload,
  });

describe('GET /:code', () => {
  it('redirects with 302 and forbids caching so every click reaches the service', async () => {
    const { code } = await createLink(ctx.app, owner.headers, {
      url: 'https://example.com/landing?a=1#top',
    });
    const res = await visit(code);

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://example.com/landing?a=1#top');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('works for anonymous links and custom aliases', async () => {
    const anon = await createLink(ctx.app, {}, { url: 'https://example.com/anon' });
    await createLink(ctx.app, owner.headers, {
      url: 'https://example.com/alias',
      customAlias: 'Go-Now',
    });

    expect((await visit(anon.code)).headers.location).toBe('https://example.com/anon');
    expect((await visit('Go-Now')).headers.location).toBe('https://example.com/alias');
    expect((await visit('go-now')).statusCode).toBe(404); // codes are case-sensitive
  });

  it('answers 404 with the standard error body for unknown and malformed codes', async () => {
    for (const code of ['doesnotexist', 'x', 'has.dot', 'a'.repeat(100), '%20%20%20']) {
      const res = await visit(code);
      expect(res.statusCode, code).toBe(404);
      expect(res.json().error.code).toBe('LINK_NOT_FOUND');
    }
  });

  it('shows browsers a readable HTML page and API clients JSON', async () => {
    const res = await visit('missing1', { accept: 'text/html,application/xhtml+xml' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Link not found');
  });

  it('answers 410 Gone for expired links', async () => {
    const link = await createLink(ctx.app, owner.headers, {
      url: 'https://example.com',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect((await visit(link.code)).statusCode).toBe(302);

    // Move the expiry into the past directly in the database, as if time had passed.
    await ctx.dependencies.pool.query(
      "UPDATE links SET expires_at = now() - interval '1 second' WHERE code = $1",
      [link.code],
    );
    await ctx.dependencies.redis.flushdb(); // drop the cached copy; expiry is also re-checked on cached copies

    const res = await visit(link.code);
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('LINK_GONE');
    expect((await visit(link.code, { accept: 'text/html' })).body).toContain('no longer available');
  });

  it('stops redirecting the moment a link is disabled, and resumes when re-enabled', async () => {
    const { code } = await createLink(ctx.app, owner.headers, { url: 'https://example.com' });
    expect((await visit(code)).statusCode).toBe(302); // now cached

    await patch(code, { isActive: false });
    expect((await visit(code)).statusCode).toBe(410);

    await patch(code, { isActive: true });
    expect((await visit(code)).statusCode).toBe(302);
  });

  it('uses the new destination immediately after an edit', async () => {
    const { code } = await createLink(ctx.app, owner.headers, { url: 'https://old.example/' });
    expect((await visit(code)).headers.location).toBe('https://old.example/');

    await patch(code, { url: 'https://new.example/' });
    expect((await visit(code)).headers.location).toBe('https://new.example/');
  });

  it('answers 410 after deletion and never reuses the code', async () => {
    const { code } = await createLink(ctx.app, owner.headers, { url: 'https://example.com' });
    await visit(code);

    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/links/${code}`,
      headers: owner.headers,
    });
    expect((await visit(code)).statusCode).toBe(410);
  });
});

describe('caching', () => {
  it('serves repeat visits from Redis without touching Postgres', async () => {
    const { code } = await createLink(ctx.app, owner.headers, {
      url: 'https://example.com/cached',
    });
    const cached = await ctx.dependencies.redis.get(`link:${code}`);
    expect(JSON.parse(cached ?? 'null')).toMatchObject({
      url: 'https://example.com/cached',
      isActive: true,
    });

    // Remove the row behind the cache's back: only a cache hit can still answer.
    await ctx.dependencies.pool.query('DELETE FROM links WHERE code = $1', [code]);
    expect((await visit(code)).statusCode).toBe(302);

    await ctx.dependencies.redis.del(`link:${code}`);
    expect((await visit(code)).statusCode).toBe(404);
  });

  it('spreads cache expiry with a little jitter (never shorter than the configured TTL)', async () => {
    const ttls = new Set();
    for (let i = 0; i < 25; i++) {
      const { code } = await createLink(ctx.app, owner.headers, {
        url: `https://example.com/${i}`,
      });
      const ttl = await ctx.dependencies.redis.ttl(`link:${code}`);
      expect(ttl).toBeGreaterThanOrEqual(3_599); // 3600s default, minus a second of test latency
      expect(ttl).toBeLessThanOrEqual(3_960); // 3600s + 10%
      ttls.add(ttl);
    }
    expect(ttls.size).toBeGreaterThan(1);
  });

  it('remembers unknown codes briefly so probing does not hit the database', async () => {
    expect((await visit('probe-me')).statusCode).toBe(404);
    expect(await ctx.dependencies.redis.get('link:probe-me')).toBe('null');
    expect(await ctx.dependencies.redis.ttl('link:probe-me')).toBeLessThanOrEqual(60);
  });

  it('lets a freshly created alias take over a code that was recently probed', async () => {
    expect((await visit('brand-new')).statusCode).toBe(404); // negative cache entry
    await createLink(ctx.app, owner.headers, {
      url: 'https://example.com/new',
      customAlias: 'brand-new',
    });

    expect((await visit('brand-new')).headers.location).toBe('https://example.com/new');
  });

  it('never caches malformed codes', async () => {
    await visit('bad.code');
    expect(await ctx.dependencies.redis.keys('link:*')).toEqual([]);
  });
});

describe('click capture', () => {
  it('queues one event per visit with the request details', async () => {
    const { code } = await createLink(ctx.app, owner.headers, { url: 'https://example.com' });
    const link = await ctx.dependencies.pool.query('SELECT id FROM links WHERE code = $1', [code]);

    await visit(code, {
      'user-agent': CHROME,
      referer: 'https://news.ycombinator.com/item?id=1',
      'cf-ipcountry': 'in',
    });
    await waitForQueued(1);

    const [event] = await queuedEvents();
    expect(event).toMatchObject({
      linkId: link.rows[0].id,
      userAgent: CHROME,
      referrer: 'https://news.ycombinator.com/item?id=1',
      country: 'IN',
    });
    expect(event?.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(event)).not.toContain('127.0.0.1'); // the raw IP is never queued
  });

  it('does not count HEAD requests or dead links', async () => {
    const { code } = await createLink(ctx.app, owner.headers, { url: 'https://example.com' });

    await visit(code, {}, 'HEAD');
    await visit('nope-nope');
    await patch(code, { isActive: false });
    await visit(code);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(await ctx.dependencies.redis.xlen(streamKey())).toBe(0);
  });

  it('turns queued clicks into counts once the worker has run', async () => {
    const { code } = await createLink(ctx.app, owner.headers, { url: 'https://example.com' });
    await visit(code, { 'user-agent': CHROME });
    await visit(code, { 'user-agent': CHROME });
    await visit(code, { 'user-agent': 'curl/8.4.0' }); // automation: stored, but not counted
    await waitForQueued(3);

    expect(await drainClicks(ctx.dependencies)).toBe(3);

    const link = (
      await ctx.app.inject({ method: 'GET', url: `/api/v1/links/${code}`, headers: owner.headers })
    ).json();
    expect(link.clickCount).toBe(2); // curl is recognised as automation and excluded from the human count
  });
});

describe('when Redis is unavailable', () => {
  it('keeps redirecting from Postgres and reports itself as degraded', async () => {
    const degraded = await createTestContext({
      REDIS_URL: 'redis://127.0.0.1:6390/0',
      RATE_LIMIT_ENABLED: 'true',
    });
    try {
      // Everything below has to work with no cache, no click queue and no rate-limit store.
      const user = await signUp(degraded.app);
      const created = await degraded.app.inject({
        method: 'POST',
        url: '/api/v1/links',
        headers: user.headers,
        payload: { url: 'https://example.com/resilient' },
      });
      expect(created.statusCode).toBe(201);

      const res = await degraded.app.inject({ method: 'GET', url: `/${created.json().code}` });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('https://example.com/resilient');

      const ready = await degraded.app.inject({ method: 'GET', url: '/health/ready' });
      expect(ready.statusCode).toBe(503);
      expect(ready.json()).toEqual({
        status: 'degraded',
        checks: { postgres: 'up', redis: 'down' },
      });

      const live = await degraded.app.inject({ method: 'GET', url: '/health/live' });
      expect(live.statusCode).toBe(200); // the process itself is fine: do not restart it
    } finally {
      await degraded.close();
    }
  });
});
