import SwaggerParser from '@apidevtools/swagger-parser';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLink, createTestContext, resetState, signUp } from '../helpers/context.js';

let ctx;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(resetState);

describe('health probes', () => {
  it('liveness only says the process is up', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('readiness checks Postgres and Redis', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: { postgres: 'up', redis: 'up' } });
  });
});

describe('observability', () => {
  // Metrics accumulate per app instance, so each test gets its own to keep the counts exact.
  let fresh;
  beforeEach(async () => {
    fresh = await createTestContext();
  });
  afterEach(() => fresh.close());

  it('exposes Prometheus metrics for traffic, cache behaviour and the click queue', async () => {
    const user = await signUp(fresh.app);
    const { code } = await createLink(fresh.app, user.headers, { url: 'https://example.com' });
    await fresh.app.inject({ method: 'GET', url: `/${code}` });
    await fresh.app.inject({ method: 'GET', url: '/unknown-code' });

    const res = await fresh.app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toMatch(
      /http_request_duration_seconds_count\{[^}]*route="\/:code"[^}]*status="302"[^}]*\} 1/,
    );
    expect(res.body).toMatch(/redirects_total\{outcome="redirect"\} 1/);
    expect(res.body).toMatch(/redirects_total\{outcome="not_found"\} 1/);
    expect(res.body).toMatch(/link_cache_lookups_total\{result="hit"\} 1/);
    expect(res.body).toContain('click_stream_length');
    expect(res.body).toContain('process_cpu_user_seconds_total');
  });

  it('uses route patterns, not raw URLs, as metric labels', async () => {
    for (const code of ['aaa-1', 'bbb-2', 'ccc-3'])
      await fresh.app.inject({ method: 'GET', url: `/${code}` });

    const { body } = await fresh.app.inject({ method: 'GET', url: '/metrics' });
    expect(body).not.toContain('aaa-1');
    expect(body).toMatch(/route="\/:code"[^}]*status="404"[^}]*\} 3/);
  });

  it('tags every response with a request id and honours one supplied by a proxy', async () => {
    const generated = await fresh.app.inject({ method: 'GET', url: '/health/live' });
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const supplied = await fresh.app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'trace-abc-123' },
    });
    expect(supplied.headers['x-request-id']).toBe('trace-abc-123');

    // A hostile or absurd id is replaced rather than echoed into logs and headers.
    for (const bad of ['has spaces and "quotes"', 'x'.repeat(200), 'line\tbreak']) {
      const res = await fresh.app.inject({
        method: 'GET',
        url: '/health/live',
        headers: { 'x-request-id': bad },
      });
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    }

    const failing = await fresh.app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(failing.json().requestId).toBe(failing.headers['x-request-id']);
  });
});

describe('HTTP hardening', () => {
  it('sends security headers and hides the framework', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health/live' });

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('answers a malformed percent-escape in the URL with a 400, not a 500', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/%E0%A4%A' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });

  it('asks keep-alive clients to reconnect elsewhere once shutdown has started', async () => {
    // supertest always sends `Connection: close`, so this one needs a real keep-alive client.
    const server = await new Promise((resolve) => {
      const listening = ctx.app.listen(0, () => resolve(listening));
    });
    const url = `http://127.0.0.1:${server.address().port}/health/live`;

    try {
      expect((await fetch(url)).headers.get('connection')).toBe('keep-alive');

      ctx.app.locals.shuttingDown = true;
      expect((await fetch(url)).headers.get('connection')).toBe('close');
    } finally {
      ctx.app.locals.shuttingDown = false;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('answers unknown routes with the standard JSON error', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/does/not/exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('does not expose stack traces or internals when something breaks', async () => {
    await ctx.container.pool.query('ALTER TABLE links RENAME TO links_gone');
    try {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/links',
        payload: { url: 'https://example.com' },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      });
      expect(res.body).not.toMatch(/links_gone|relation|SELECT|INSERT|at \w+/);
    } finally {
      await ctx.container.pool.query('ALTER TABLE links_gone RENAME TO links');
    }
  });

  it('applies no CORS headers unless origins are configured', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();

    const open = await createTestContext({ CORS_ORIGINS: 'https://app.example' });
    try {
      const allowed = await open.app.inject({
        method: 'GET',
        url: '/health/live',
        headers: { origin: 'https://app.example' },
      });
      expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example');
      const denied = await open.app.inject({
        method: 'GET',
        url: '/health/live',
        headers: { origin: 'https://evil.example' },
      });
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await open.close();
    }
  });

  describe('client address behind a reverse proxy', () => {
    // The visitor hash is derived from the client IP, so it reveals which address the app used.
    const visitorHashes = async (context, forwardedFor) => {
      const user = await signUp(context.app);
      const { code } = await createLink(context.app, user.headers, { url: 'https://example.com' });
      for (const value of forwardedFor) {
        await context.app.inject({
          method: 'GET',
          url: `/${code}`,
          headers: { 'x-forwarded-for': value, 'user-agent': 'Mozilla/5.0 (test)' },
        });
      }
      const streamKey = context.config.clicks.streamKey;
      await vi.waitFor(async () =>
        expect(await context.container.redis.xlen(streamKey)).toBe(forwardedFor.length),
      );
      const entries = await context.container.redis.xrange(streamKey, '-', '+');
      return entries.map(([, fields]) => JSON.parse(fields[1]).visitorHash);
    };

    it('trusts only the entries the nearest proxy added, so a spoofed header changes nothing', async () => {
      // One trusted hop (the test default): the right-most entry is the address the proxy saw.
      const [honest, spoofed, other] = await visitorHashes(ctx, [
        '198.51.100.77',
        '1.2.3.4, 198.51.100.77', // client-supplied prefix is ignored
        '198.51.100.78',
      ]);

      expect(spoofed).toBe(honest);
      expect(other).not.toBe(honest);
    });

    it('ignores X-Forwarded-For completely when no proxy is trusted', async () => {
      await resetState();
      const direct = await createTestContext({ TRUST_PROXY_HOPS: '0' });
      try {
        const [first, second] = await visitorHashes(direct, ['198.51.100.77', '198.51.100.78']);
        expect(second).toBe(first); // both requests come from the same socket address
      } finally {
        await direct.close();
      }
    });
  });
});

describe('OpenAPI documentation', () => {
  it('describes every public endpoint, generated from the validation schemas', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json();

    expect(spec.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/auth/register',
        '/api/v1/auth/login',
        '/api/v1/auth/me',
        '/api/v1/links',
        '/api/v1/links/{code}',
        '/api/v1/links/{code}/analytics',
        '/api/v1/links/{code}/qr',
        '/{code}',
        '/health/ready',
      ]),
    );
    expect(spec.paths['/metrics']).toBeUndefined(); // hidden on purpose
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(
      spec.paths['/api/v1/links'].post.requestBody.content['application/json'].schema.properties
        .url,
    ).toBeDefined();
  });

  it('serves the interactive Swagger UI (following the redirect to the trailing slash)', async () => {
    let res = await ctx.app.inject({ method: 'GET', url: '/docs' });
    if (res.statusCode >= 300 && res.statusCode < 400) {
      res = await ctx.app.inject({ method: 'GET', url: res.headers.location });
    }

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body.toLowerCase()).toContain('swagger');
  });

  it('produces a document that passes OpenAPI validation', async () => {
    const spec = (await ctx.app.inject({ method: 'GET', url: '/docs/json' })).json();
    await expect(SwaggerParser.validate(structuredClone(spec))).resolves.toBeDefined();
  });
});

describe('rate limiting', () => {
  let limited;

  beforeAll(async () => {
    limited = await createTestContext({
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_CREATE_ANON_PER_MINUTE: '3',
      RATE_LIMIT_CREATE_USER_PER_MINUTE: '50',
      RATE_LIMIT_AUTH_PER_MINUTE: '100',
      RATE_LIMIT_API_PER_MINUTE: '6',
    });
  });
  afterAll(() => limited.close());

  const createAnonymous = (remoteAddress) =>
    limited.app.inject({
      method: 'POST',
      url: '/api/v1/links',
      payload: { url: 'https://example.com' },
      remoteAddress,
    });

  it('throttles anonymous link creation per client address', async () => {
    for (let i = 0; i < 3; i++)
      expect((await createAnonymous('198.51.100.1')).statusCode).toBe(201);

    const blocked = await createAnonymous('198.51.100.1');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.headers['x-ratelimit-limit']).toBe('3');

    expect((await createAnonymous('198.51.100.2')).statusCode).toBe(201); // another client is unaffected
  });

  it('reports the remaining budget on successful requests', async () => {
    const res = await createAnonymous('198.51.100.3');
    expect(res.headers['x-ratelimit-limit']).toBe('3');
    expect(res.headers['x-ratelimit-remaining']).toBe('2');
  });

  it('gives signed-in users a separate, larger budget that follows the account', async () => {
    const user = await signUp(limited.app);
    for (let i = 0; i < 10; i++) {
      const res = await limited.app.inject({
        method: 'POST',
        url: '/api/v1/links',
        headers: user.headers,
        payload: { url: 'https://example.com' },
        remoteAddress: `198.51.100.${10 + (i % 2)}`, // switching IPs does not reset the account's budget
      });
      expect(res.statusCode).toBe(201);
    }
  });

  it('counts each endpoint separately', async () => {
    for (let i = 0; i < 4; i++) await createAnonymous('198.51.100.4');
    // Creation is exhausted for this client, but other endpoints still have their own budget.
    const other = await limited.app.inject({
      method: 'GET',
      url: '/api/v1/links',
      remoteAddress: '198.51.100.4',
    });
    expect(other.statusCode).toBe(401);
  });

  it('applies a default budget to the rest of the API', async () => {
    const statuses = [];
    for (let i = 0; i < 8; i++) {
      statuses.push(
        (
          await limited.app.inject({
            method: 'GET',
            url: '/api/v1/links',
            remoteAddress: '198.51.100.5',
          })
        ).statusCode,
      );
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 401, 429, 429]);
  });

  it('also counts requests that carry a bad token, so failed logins cannot be replayed for free', async () => {
    const statuses = [];
    for (let i = 0; i < 8; i++) {
      const res = await limited.app.inject({
        method: 'GET',
        url: '/api/v1/links',
        headers: { authorization: 'Bearer forged.token.value' },
        remoteAddress: '198.51.100.7',
      });
      statuses.push(res.statusCode);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 401, 429, 429]);
  });

  it('never throttles redirects or health checks', async () => {
    const link = (await createAnonymous('198.51.100.6')).json();
    for (let i = 0; i < 20; i++) {
      expect(
        (
          await limited.app.inject({
            method: 'GET',
            url: `/${link.code}`,
            remoteAddress: '198.51.100.6',
          })
        ).statusCode,
      ).toBe(302);
    }
    expect(
      (
        await limited.app.inject({
          method: 'GET',
          url: '/health/live',
          remoteAddress: '198.51.100.6',
        })
      ).statusCode,
    ).toBe(200);
  });

  it('slows down password guessing on the login endpoint', async () => {
    const strict = await createTestContext({
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_AUTH_PER_MINUTE: '3',
    });
    try {
      const attempt = (password) =>
        strict.app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: 'victim@example.com', password },
          remoteAddress: '203.0.113.9',
        });

      const results = [];
      for (let i = 0; i < 5; i++) results.push((await attempt(`guess-${i}`)).statusCode);
      expect(results).toEqual([401, 401, 401, 429, 429]);
    } finally {
      await strict.close();
    }
  });
});
