import { describe, expect, it, vi } from 'vitest';
import { createApiClient, createApiError, getErrorMessage, isApiError } from './client.js';

const json = (status, body) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const setup = (respond, { token = null, onSessionExpired } = {}) => {
  const fetchFn = vi.fn(async () => respond());
  const client = createApiClient({ getToken: () => token, onSessionExpired, fetchFn });
  return { client, fetchFn, lastCall: () => fetchFn.mock.calls.at(-1) };
};

describe('createApiClient', () => {
  it('sends the bearer token when there is one, and reads it fresh on every request', async () => {
    let token = null;
    const fetchFn = vi.fn(async () => json(200, { items: [], nextCursor: null }));
    const client = createApiClient({ getToken: () => token, fetchFn });

    await client.listLinks();
    expect(fetchFn.mock.calls[0][1].headers.authorization).toBeUndefined();

    token = 'tok-9';
    await client.listLinks();
    expect(fetchFn.mock.calls[1][1].headers.authorization).toBe('Bearer tok-9');
  });

  it('never sends the token to the credential endpoints', async () => {
    const { client, lastCall } = setup(() => json(200, { token: 't' }), { token: 'old-token' });

    await client.login('a@example.com', 'password-123');
    expect(lastCall()[1].headers.authorization).toBeUndefined();

    await client.register('a@example.com', 'password-123');
    expect(lastCall()[1].headers.authorization).toBeUndefined();
  });

  it('sends JSON bodies with the right content type and returns parsed JSON', async () => {
    const { client, lastCall } = setup(() => json(201, { code: 'abc' }), { token: 't' });

    const result = await client.createLink({ url: 'https://example.com', customAlias: 'my-link' });

    expect(result).toEqual({ code: 'abc' });
    const [url, init] = lastCall();
    expect(url).toBe('/api/v1/links');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ url: 'https://example.com', customAlias: 'my-link' });
  });

  it('returns null for 204 No Content', async () => {
    const { client } = setup(() => new Response(null, { status: 204 }), { token: 't' });
    await expect(client.deleteLink('abc')).resolves.toBeNull();
  });

  it('turns error responses into ApiError with status, code and details', async () => {
    const { client } = setup(
      () =>
        json(400, {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: [{ path: 'url' }],
          },
        }),
      { token: 't' },
    );

    const error = await client.createLink({ url: '' }).catch((e) => e);

    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      details: [{ path: 'url' }],
    });
    expect(error.message).toBe('Request validation failed');
  });

  it('copes with error responses that are not JSON', async () => {
    const { client } = setup(() => new Response('Bad gateway', { status: 502 }), { token: 't' });
    const error = await client.listLinks().catch((e) => e);
    expect(error).toMatchObject({ status: 502, message: 'Request failed (502)' });
  });

  describe('session expiry', () => {
    const errorResponse = (code) => () => json(401, { error: { code, message: 'nope' } });

    it.each(['TOKEN_EXPIRED', 'INVALID_TOKEN'])(
      'reports %s when a token was sent',
      async (code) => {
        const onSessionExpired = vi.fn();
        const { client } = setup(errorResponse(code), { token: 't', onSessionExpired });

        await client.me().catch(() => undefined);

        expect(onSessionExpired).toHaveBeenCalledOnce();
      },
    );

    it('does not treat a wrong password as an expired session', async () => {
      const onSessionExpired = vi.fn();
      const { client } = setup(errorResponse('INVALID_CREDENTIALS'), {
        token: 't',
        onSessionExpired,
      });

      await client.login('a@example.com', 'wrong').catch(() => undefined);

      expect(onSessionExpired).not.toHaveBeenCalled();
    });

    it('stays quiet when nobody was signed in', async () => {
      const onSessionExpired = vi.fn();
      const { client } = setup(errorResponse('INVALID_TOKEN'), { token: null, onSessionExpired });

      await client.listLinks().catch(() => undefined);

      expect(onSessionExpired).not.toHaveBeenCalled();
    });
  });

  describe('request building', () => {
    const okList = () => json(200, { items: [], nextCursor: null });

    it('builds the list query from the options that are set', async () => {
      const { client, lastCall } = setup(okList, { token: 't' });

      await client.listLinks({ limit: 20, cursor: 'c1', q: 'hello world' });
      expect(lastCall()[0]).toBe('/api/v1/links?limit=20&cursor=c1&q=hello+world');

      await client.listLinks({ limit: 20 });
      expect(lastCall()[0]).toBe('/api/v1/links?limit=20');

      await client.listLinks();
      expect(lastCall()[0]).toBe('/api/v1/links?');
    });

    it('builds the analytics query', async () => {
      const { client, lastCall } = setup(() => json(200, {}), { token: 't' });

      await client.getAnalytics('abc', {
        interval: 'hour',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        includeBots: true,
      });

      const url = new URL(lastCall()[0], 'http://x');
      expect(url.pathname).toBe('/api/v1/links/abc/analytics');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        interval: 'hour',
        includeBots: 'true',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
      });
    });

    it('encodes codes in paths and builds QR image URLs', async () => {
      const { client, lastCall } = setup(() => json(200, {}), { token: 't' });

      await client.updateLink('we ird/code', { isActive: false });
      expect(lastCall()[0]).toBe('/api/v1/links/we%20ird%2Fcode');
      expect(lastCall()[1].method).toBe('PATCH');

      expect(client.qrUrl('abc')).toBe('/api/v1/links/abc/qr?size=240');
      expect(client.qrUrl('a b', 128)).toBe('/api/v1/links/a%20b/qr?size=128');
    });

    it('passes an abort signal through to fetch', async () => {
      const { client, lastCall } = setup(okList, { token: 't' });
      const controller = new AbortController();

      await client.listLinks({}, { signal: controller.signal });

      expect(lastCall()[1].signal).toBe(controller.signal);
    });
  });
});

describe('getErrorMessage', () => {
  it('lists validation problems with their field names', () => {
    const error = createApiError(400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: [
          { in: 'body', path: 'url', message: 'Too small' },
          { in: 'body', path: '', message: 'Invalid input' },
        ],
      },
    });
    expect(getErrorMessage(error)).toBe('url: Too small. Invalid input');
  });

  it('uses the message of other errors and has a fallback for unknown values', () => {
    expect(
      getErrorMessage(createApiError(409, { error: { code: 'ALIAS_TAKEN', message: 'Taken' } })),
    ).toBe('Taken');
    expect(getErrorMessage(new Error('Network down'))).toBe('Network down');
    expect(getErrorMessage('weird')).toBe('Something went wrong');
  });
});
