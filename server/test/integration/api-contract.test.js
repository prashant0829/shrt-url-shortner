import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { analyticsView } from '../../src/schemas/analytics.schemas.js';
import { authResponse, meResponse } from '../../src/schemas/auth.schemas.js';
import { linkListView, linkView } from '../../src/schemas/link.schemas.js';
import { errorResponse } from '../../src/schemas/error.schemas.js';
import { createLink, createTestContext, resetState, signUp } from '../helpers/context.js';

/**
 * The OpenAPI document is generated from these very schemas, so if a response ever stops
 * matching, the published documentation would be lying. `.strict()` also rejects extra fields,
 * which catches accidental leaks (password hashes, internal ids) as well as missing ones.
 */
const conforms = (schema, body) => schema.strict().parse(body);

let ctx;
let user;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await resetState();
  user = await signUp(ctx.app);
});

const call = (method, url, { headers = user.headers, payload } = {}) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers, payload });

describe('responses match their documented schemas', () => {
  it('auth: register, login and me', async () => {
    const registered = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'contract@example.com', password: 'a-good-password' },
    });
    conforms(authResponse, registered.json());

    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'contract@example.com', password: 'a-good-password' },
    });
    conforms(authResponse, login.json());

    conforms(meResponse, (await call('GET', '/auth/me')).json());
  });

  it('links: create, read, update and list', async () => {
    const created = await call('POST', '/links', {
      payload: {
        url: 'https://example.com/contract',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });
    expect(created.statusCode).toBe(201);
    const link = conforms(linkView, created.json());

    conforms(linkView, (await call('GET', `/links/${link.code}`)).json());
    conforms(
      linkView,
      (await call('PATCH', `/links/${link.code}`, { payload: { isActive: false } })).json(),
    );

    const page = conforms(linkListView, (await call('GET', '/links?limit=5')).json());
    expect(page.items).toHaveLength(1);
  });

  it('analytics: a link with and without data', async () => {
    const { code } = await createLink(ctx.app, user.headers, { url: 'https://example.com' });
    const report = conforms(analyticsView, (await call('GET', `/links/${code}/analytics`)).json());
    expect(report.series.length).toBeGreaterThan(0);
  });

  it.each([
    ['validation', () => call('POST', '/links', { payload: { url: '' } }), 400],
    [
      'malformed JSON',
      () =>
        ctx.app.inject({
          method: 'POST',
          url: '/api/v1/links',
          headers: { 'content-type': 'application/json' },
          payload: '{',
        }),
      400,
    ],
    ['unauthenticated', () => call('GET', '/links', { headers: {} }), 401],
    [
      'invalid token',
      () => call('GET', '/links', { headers: { authorization: 'Bearer nope' } }),
      401,
    ],
    ['not found', () => call('GET', '/links/missing-link'), 404],
    ['unknown route', () => ctx.app.inject({ method: 'GET', url: '/api/v1/nothing/here' }), 404],
    [
      'conflict',
      async () => {
        await createLink(ctx.app, user.headers, {
          url: 'https://example.com',
          customAlias: 'taken-alias',
        });
        return call('POST', '/links', {
          payload: { url: 'https://example.com', customAlias: 'taken-alias' },
        });
      },
      409,
    ],
  ])('errors: %s uses the standard error body', async (_name, act, status) => {
    const res = await act();
    expect(res.statusCode).toBe(status);
    const { error, requestId } = conforms(errorResponse, res.json());
    expect(error.code).toMatch(/^[A-Z_]+$/);
    expect(requestId).toBe(res.headers['x-request-id']);
  });
});
