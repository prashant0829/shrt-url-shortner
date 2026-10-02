import { vi } from 'vitest';

/**
 * A fake `fetch` for the API. `routes` maps "METHOD /path" (without the /api/v1 prefix) to a
 * `{ status, body }` response, or to a function of the recorded call that returns one.
 * Every request is recorded, so tests can assert on what the UI sent.
 */
export function createFakeApi(routes = {}) {
  const calls = [];

  const fetchFn = vi.fn(async (input, init = {}) => {
    const url = new URL(input, 'http://localhost');
    const method = init.method ?? 'GET';
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const call = {
      method,
      path,
      query: Object.fromEntries(url.searchParams),
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);

    const handler = routes[`${method} ${path}`];
    if (!handler) throw new Error(`Unhandled request: ${method} ${path}`);

    const { status = 200, body = null } =
      typeof handler === 'function' ? await handler(call) : handler;
    return new Response(status === 204 || body === null ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });

  return {
    fetchFn,
    calls,
    callsTo: (method, path) => calls.filter((c) => c.method === method && c.path === path),
  };
}

export const makeLink = (overrides = {}) => ({
  code: 'abc1234',
  shortUrl: 'http://short.test/abc1234',
  originalUrl: 'https://example.com/a/long/path',
  isActive: true,
  expiresAt: null,
  clickCount: 3,
  createdAt: new Date(Date.now() - 3_600_000).toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

export const makeSession = (email = 'demo@example.com', token = 'tok-1') => ({
  token,
  expiresIn: 3600,
  user: { id: 'user-1', email, createdAt: new Date().toISOString() },
});

export const makeReport = (overrides = {}) => ({
  code: 'abc1234',
  range: { from: '2026-09-22T00:00:00.000Z', to: '2026-09-29T12:00:00.000Z', interval: 'day' },
  totals: { clicks: 482, uniqueVisitors: 197 },
  series: Array.from({ length: 8 }, (_, i) => ({
    bucket: new Date(Date.UTC(2026, 8, 22 + i)).toISOString(),
    clicks: i === 7 ? 202 : (i + 1) * 10, // sums to 482, matching `totals` below
  })),
  breakdowns: {
    countries: [
      { label: 'US', clicks: 148 },
      { label: 'IN', clicks: 86 },
    ],
    browsers: [{ label: 'Chrome', clicks: 203 }],
    operatingSystems: [{ label: 'Linux', clicks: 100 }],
    devices: [{ label: 'desktop', clicks: 289 }],
    referrers: [{ label: 'Direct', clicks: 174 }],
  },
  ...overrides,
});

export const errorBody = (code, message, details) => ({
  error: { code, message, details },
  requestId: 'req-1',
});
