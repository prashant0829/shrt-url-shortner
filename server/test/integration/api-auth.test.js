import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, resetState, signUp } from '../helpers/context.js';

let ctx;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(resetState);

const post = (url, payload) => ctx.app.inject({ method: 'POST', url, payload: payload });

describe('POST /api/v1/auth/register', () => {
  it('creates an account and returns a token that works immediately', async () => {
    const res = await post('/api/v1/auth/register', {
      email: 'new@example.com',
      password: 'a-good-password',
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ expiresIn: 3600, user: { email: 'new@example.com' } });
    expect(body.token.split('.')).toHaveLength(3);

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.id).toBe(body.user.id);
  });

  it('normalises the email address', async () => {
    const res = await post('/api/v1/auth/register', {
      email: '  MiXeD@Example.COM ',
      password: 'a-good-password',
    });
    expect(res.json().user.email).toBe('mixed@example.com');
  });

  it('rejects a second account for the same email regardless of case', async () => {
    await post('/api/v1/auth/register', { email: 'dup@example.com', password: 'a-good-password' });
    const res = await post('/api/v1/auth/register', {
      email: 'DUP@example.com',
      password: 'another-password',
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_TAKEN');
  });

  it.each([
    ['not an email', { email: 'nope', password: 'a-good-password' }, 'email'],
    ['short password', { email: 'a@example.com', password: 'short' }, 'password'],
    ['huge password', { email: 'a@example.com', password: 'x'.repeat(129) }, 'password'],
    ['missing password', { email: 'a@example.com' }, 'password'],
    ['missing body fields', {}, 'email'],
  ])('validates input: %s', async (_name, payload, field) => {
    const res = await post('/api/v1/auth/register', payload);

    expect(res.statusCode).toBe(400);
    const { error, requestId } = res.json();
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details.map((d) => d.path)).toContain(field);
    expect(requestId).toEqual(expect.any(String));
  });

  it('never returns the password or its hash', async () => {
    const res = await post('/api/v1/auth/register', {
      email: 'safe@example.com',
      password: 'a-good-password',
    });
    expect(res.body).not.toMatch(/password|scrypt/i);
  });

  it('stores only a salted hash', async () => {
    await post('/api/v1/auth/register', { email: 'hash@example.com', password: 'a-good-password' });
    const { rows } = await ctx.container.pool.query('SELECT password_hash FROM users');
    expect(rows[0].password_hash).toMatch(/^scrypt\$/);
    expect(rows[0].password_hash).not.toContain('a-good-password');
  });
});

describe('POST /api/v1/auth/login', () => {
  beforeEach(async () => {
    await post('/api/v1/auth/register', {
      email: 'login@example.com',
      password: 'a-good-password',
    });
  });

  it('returns a token for valid credentials, ignoring email case', async () => {
    const res = await post('/api/v1/auth/login', {
      email: 'LOGIN@example.com',
      password: 'a-good-password',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().token).toEqual(expect.any(String));
  });

  it('answers a wrong password and an unknown email identically', async () => {
    const wrongPassword = await post('/api/v1/auth/login', {
      email: 'login@example.com',
      password: 'wrong-password',
    });
    const unknownEmail = await post('/api/v1/auth/login', {
      email: 'ghost@example.com',
      password: 'a-good-password',
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json().error).toEqual(unknownEmail.json().error);
  });
});

describe('GET /api/v1/auth/me and bearer token handling', () => {
  const me = (headers = {}) => ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers });

  it('requires authentication', async () => {
    const res = await me();
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it.each([
    ['a non-bearer scheme', 'Basic dXNlcjpwYXNz'],
    ['a bearer header without a token', 'Bearer'],
    ['a garbage token', 'Bearer not.a.jwt'],
  ])('rejects %s', async (_name, authorization) => {
    const res = await me({ authorization });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_TOKEN');
  });

  it('rejects a token that was signed with a different secret', async () => {
    const other = await createTestContext({
      JWT_SECRET: 'a-completely-different-secret-value-9999',
    });
    try {
      const foreign = await signUp(other.app);
      const res = await me(foreign.headers);
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('INVALID_TOKEN');
    } finally {
      await other.close();
    }
  });

  it('rejects an expired token with a distinct code', async () => {
    const short = await createTestContext({ JWT_TTL_SECONDS: '1' });
    try {
      const user = await signUp(short.app);
      await new Promise((resolve) => setTimeout(resolve, 2_100));
      const res = await short.app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: user.headers,
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('TOKEN_EXPIRED');
    } finally {
      await short.close();
    }
  });

  it('rejects a valid token whose account no longer exists', async () => {
    const user = await signUp(ctx.app);
    await ctx.container.pool.query('DELETE FROM users');

    const res = await me(user.headers);
    expect(res.statusCode).toBe(401);
  });

  it('treats an invalid token as an error even on public routes, so stale sessions are noticed', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/links',
      headers: { authorization: 'Bearer stale.token.value' },
      payload: { url: 'https://example.com' },
    });
    expect(res.statusCode).toBe(401);
  });
});
