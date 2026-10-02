import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLink, createTestContext, resetState, signUp } from '../helpers/context.js';

let ctx;

let alice;
let bob;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await resetState();
  alice = await signUp(ctx.app, 'alice@example.com');
  bob = await signUp(ctx.app, 'bob@example.com');
});

const api = (method, url, headers = {}, payload) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers, payload: payload });

const futureIso = (ms = 3_600_000) => new Date(Date.now() + ms).toISOString();

describe('POST /api/v1/links', () => {
  it('creates an anonymous link with a generated 7-character code', async () => {
    const res = await api('POST', '/links', {}, { url: 'https://example.com/page' });

    expect(res.statusCode).toBe(201);
    const link = res.json();
    expect(link.code).toMatch(/^[0-9A-Za-z]{7}$/);
    expect(link).toMatchObject({
      shortUrl: `http://short.test/${link.code}`,
      originalUrl: 'https://example.com/page',
      isActive: true,
      expiresAt: null,
      clickCount: 0,
    });
    const { rows } = await ctx.container.pool.query('SELECT user_id FROM links WHERE code = $1', [
      link.code,
    ]);
    expect(rows[0].user_id).toBeNull();
  });

  it('attaches the link to the signed-in user', async () => {
    const link = await createLink(ctx.app, alice.headers, { url: 'https://example.com' });
    const { rows } = await ctx.container.pool.query('SELECT user_id FROM links WHERE code = $1', [
      link.code,
    ]);
    expect(rows[0].user_id).toBe(alice.userId);
  });

  it('canonicalises the destination URL', async () => {
    const link = await createLink(ctx.app, {}, { url: '  HTTPS://Example.COM/A b ' });
    expect(link.originalUrl).toBe('https://example.com/A%20b');
  });

  it('supports custom aliases, expiry and case-sensitive codes', async () => {
    const expiresAt = futureIso();
    const link = await createLink(ctx.app, alice.headers, {
      url: 'https://example.com',
      customAlias: 'My-Promo_1',
      expiresAt,
    });

    expect(link.code).toBe('My-Promo_1');
    expect(link.expiresAt).toBe(expiresAt);
    expect(
      (
        await api('POST', '/links', alice.headers, {
          url: 'https://example.com',
          customAlias: 'my-promo_1',
        })
      ).statusCode,
    ).toBe(201);
  });

  it('answers 409 for a taken alias and keeps the original intact', async () => {
    await createLink(ctx.app, alice.headers, {
      url: 'https://original.example',
      customAlias: 'taken',
    });
    const res = await api('POST', '/links', bob.headers, {
      url: 'https://hijack.example',
      customAlias: 'taken',
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ALIAS_TAKEN');
    const { rows } = await ctx.container.pool.query(
      "SELECT original_url FROM links WHERE code = 'taken'",
    );
    expect(rows[0].original_url).toBe('https://original.example/');
  });

  it.each(['api', 'docs', 'metrics', 'health', 'assets'])(
    'reserves the alias "%s"',
    async (alias) => {
      const res = await api(
        'POST',
        '/links',
        {},
        { url: 'https://example.com', customAlias: alias },
      );
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('ALIAS_RESERVED');
    },
  );

  it.each([
    ['too short', 'ab'],
    ['too long', 'a'.repeat(33)],
    ['spaces', 'has space'],
    ['slash', 'a/b'],
    ['unicode', 'café-link'],
  ])('rejects an invalid alias (%s)', async (_name, customAlias) => {
    const res = await api('POST', '/links', {}, { url: 'https://example.com', customAlias });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,hi',
    'ftp://example.com',
    'http://localhost:3000',
    'http://127.0.0.1/admin',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
    'https://user:pass@example.com',
    'not-a-url',
    'https://short.test/abc', // the service itself
  ])('refuses the destination %s', async (url) => {
    const res = await api('POST', '/links', {}, { url });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_URL');
  });

  it('refuses destinations on the configured blocklist', async () => {
    const strict = await createTestContext({ BLOCKED_DOMAINS: 'blocked.example' });
    try {
      const res = await strict.app.inject({
        method: 'POST',
        url: '/api/v1/links',
        payload: { url: 'https://sub.blocked.example/x' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await strict.close();
    }
  });

  it('validates the expiry', async () => {
    const past = await api(
      'POST',
      '/links',
      {},
      { url: 'https://example.com', expiresAt: '2020-01-01T00:00:00Z' },
    );
    expect(past.statusCode).toBe(400);
    expect(past.json().error.code).toBe('INVALID_EXPIRY');

    const malformed = await api(
      'POST',
      '/links',
      {},
      { url: 'https://example.com', expiresAt: 'tomorrow' },
    );
    expect(malformed.statusCode).toBe(400);
  });

  it('rejects malformed and oversized bodies', async () => {
    const badJson = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/links',
      headers: { 'content-type': 'application/json' },
      payload: '{"url": ',
    });
    expect(badJson.statusCode).toBe(400);
    expect(badJson.json().error.code).toBe('INVALID_JSON');

    const tooLarge = await api(
      'POST',
      '/links',
      {},
      { url: `https://example.com/${'a'.repeat(20_000)}` },
    );
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json().error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('GET /api/v1/links', () => {
  it('requires authentication', async () => {
    expect((await api('GET', '/links')).statusCode).toBe(401);
  });

  it('lists only my links, newest first', async () => {
    const first = await createLink(ctx.app, alice.headers, { url: 'https://one.example' });
    const second = await createLink(ctx.app, alice.headers, { url: 'https://two.example' });
    await createLink(ctx.app, bob.headers, { url: 'https://bobs.example' });
    await createLink(ctx.app, {}, { url: 'https://anonymous.example' });

    const res = await api('GET', '/links', alice.headers);

    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((l) => l.code)).toEqual([second.code, first.code]);
    expect(res.json().nextCursor).toBeNull();
  });

  it('paginates with a cursor', async () => {
    const created = [];
    for (let i = 0; i < 5; i++)
      created.push(await createLink(ctx.app, alice.headers, { url: `https://site${i}.example` }));
    const expected = created.map((l) => l.code).reverse();

    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const query = cursor ? `?limit=2&cursor=${encodeURIComponent(cursor)}` : '?limit=2';
      const page = (await api('GET', `/links${query}`, alice.headers)).json();
      seen.push(...page.items.map((l) => l.code));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);

    expect(seen).toEqual(expected);
    expect(pages).toBe(3);
  });

  it('filters by search text', async () => {
    await createLink(ctx.app, alice.headers, { url: 'https://docs.example/guide' });
    await createLink(ctx.app, alice.headers, {
      url: 'https://shop.example/cart',
      customAlias: 'cart-link',
    });

    const byUrl = (await api('GET', '/links?q=guide', alice.headers)).json();
    expect(byUrl.items).toHaveLength(1);
    expect(byUrl.items[0].originalUrl).toContain('docs.example');

    const byCode = (await api('GET', '/links?q=CART', alice.headers)).json();
    expect(byCode.items.map((l) => l.code)).toEqual(['cart-link']);
  });

  it.each(['limit=0', 'limit=101', 'limit=abc', 'cursor=%%%'])(
    'validates the query (%s)',
    async (query) => {
      expect((await api('GET', `/links?${query}`, alice.headers)).statusCode).toBe(400);
    },
  );
});

describe('managing a single link', () => {
  let code;
  beforeEach(async () => {
    code = (await createLink(ctx.app, alice.headers, { url: 'https://example.com/original' })).code;
  });

  it('GET returns the link to its owner only', async () => {
    expect((await api('GET', `/links/${code}`, alice.headers)).statusCode).toBe(200);
    expect((await api('GET', `/links/${code}`, bob.headers)).statusCode).toBe(404);
    expect((await api('GET', `/links/${code}`)).statusCode).toBe(401);
    expect((await api('GET', '/links/does-not-exist', alice.headers)).statusCode).toBe(404);
  });

  it('PATCH changes destination, expiry and enabled state', async () => {
    const res = await api('PATCH', `/links/${code}`, alice.headers, {
      url: 'https://example.com/updated',
      isActive: false,
      expiresAt: futureIso(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      originalUrl: 'https://example.com/updated',
      isActive: false,
    });
    expect(res.json().expiresAt).not.toBeNull();

    const cleared = await api('PATCH', `/links/${code}`, alice.headers, { expiresAt: null });
    expect(cleared.json().expiresAt).toBeNull();
  });

  it('PATCH validates its input and enforces ownership', async () => {
    expect((await api('PATCH', `/links/${code}`, alice.headers, {})).statusCode).toBe(400);
    expect(
      (await api('PATCH', `/links/${code}`, alice.headers, { url: 'http://10.0.0.1' })).statusCode,
    ).toBe(400);
    expect(
      (await api('PATCH', `/links/${code}`, alice.headers, { expiresAt: '2020-01-01T00:00:00Z' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await api('PATCH', `/links/${code}`, bob.headers, { isActive: false })).statusCode,
    ).toBe(404);
    expect((await api('PATCH', `/links/${code}`, {}, { isActive: false })).statusCode).toBe(401);

    expect((await api('GET', `/links/${code}`, alice.headers)).json().isActive).toBe(true);
  });

  it('DELETE removes the link from listings but keeps the code reserved', async () => {
    expect((await api('DELETE', `/links/${code}`, bob.headers)).statusCode).toBe(404);

    const res = await api('DELETE', `/links/${code}`, alice.headers);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');

    expect((await api('GET', `/links/${code}`, alice.headers)).statusCode).toBe(404);
    expect((await api('GET', '/links', alice.headers)).json().items).toEqual([]);
    expect((await api('DELETE', `/links/${code}`, alice.headers)).statusCode).toBe(404);

    const reuse = await api('POST', '/links', bob.headers, {
      url: 'https://evil.example',
      customAlias: code,
    });
    expect(reuse.statusCode).toBe(409);
  });

  it('anonymous links cannot be managed by anyone', async () => {
    const anonymous = await createLink(ctx.app, {}, { url: 'https://example.com/anon' });
    expect((await api('GET', `/links/${anonymous.code}`, alice.headers)).statusCode).toBe(404);
    expect((await api('DELETE', `/links/${anonymous.code}`, alice.headers)).statusCode).toBe(404);
  });
});

describe('GET /api/v1/links/:code/qr', () => {
  let code;
  beforeEach(async () => {
    code = (await createLink(ctx.app, alice.headers, { url: 'https://example.com/qr' })).code;
  });

  it('returns a PNG by default, without authentication', async () => {
    const res = await api('GET', `/links/${code}/qr`);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toContain('max-age');
    expect([...res.rawPayload.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });

  it('can return SVG and honours the size for PNG', async () => {
    const svg = await api('GET', `/links/${code}/qr?format=svg`);
    expect(svg.headers['content-type']).toContain('image/svg+xml');
    expect(svg.body).toContain('<svg');

    const small = await api('GET', `/links/${code}/qr?size=64`);
    const large = await api('GET', `/links/${code}/qr?size=1024`);
    expect(large.rawPayload.length).toBeGreaterThan(small.rawPayload.length);
  });

  it('validates parameters and reports unknown or dead links', async () => {
    expect((await api('GET', `/links/${code}/qr?size=10`)).statusCode).toBe(400);
    expect((await api('GET', `/links/${code}/qr?format=gif`)).statusCode).toBe(400);
    expect((await api('GET', '/links/unknown-code/qr')).statusCode).toBe(404);

    await api('DELETE', `/links/${code}`, alice.headers);
    expect((await api('GET', `/links/${code}/qr`)).statusCode).toBe(410);
  });
});
