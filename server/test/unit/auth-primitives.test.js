import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthService } from '../../src/services/auth.service.js';
import { createScryptPasswordHasher } from '../../src/services/password-hasher.service.js';
import { createTokenService } from '../../src/services/token.service.js';
import { createInMemoryUserStore } from '../helpers/fakes.js';

// Cheap parameters keep the suite fast; the production defaults are covered by the format test.
const fastHasher = createScryptPasswordHasher({ N: 1024, r: 8, p: 1 });

describe('ScryptPasswordHasher', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await fastHasher.hash('s3cret-passphrase');
    expect(await fastHasher.verify('s3cret-passphrase', hash)).toBe(true);
    expect(await fastHasher.verify('s3cret-passphrasE', hash)).toBe(false);
  });

  it('salts every hash', async () => {
    const [a, b] = await Promise.all([fastHasher.hash('same'), fastHasher.hash('same')]);
    expect(a).not.toBe(b);
  });

  it('stores parameters in the hash so cost can change without breaking old hashes', async () => {
    const hash = await fastHasher.hash('pw');
    expect(hash).toMatch(/^scrypt\$1024\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    // A hasher configured with different parameters still verifies it.
    expect(await createScryptPasswordHasher({ N: 2048 }).verify('pw', hash)).toBe(true);
  });

  it('uses OWASP-grade parameters by default', async () => {
    const hash = await createScryptPasswordHasher().hash('pw');
    expect(hash.startsWith(`scrypt$${2 ** 15}$8$3$`)).toBe(true);
  });

  it.each(['', 'plaintext', 'scrypt$1$2$3', 'bcrypt$1$2$3$4$5'])(
    'treats malformed stored value %j as a failed match',
    async (stored) => {
      expect(await fastHasher.verify('pw', stored)).toBe(false);
    },
  );
});

describe('TokenService', () => {
  const service = createTokenService({ secret: 'x'.repeat(40), ttlSeconds: 60 });

  afterEach(() => vi.useRealTimers());

  it('round-trips a user id', async () => {
    const { token, expiresIn } = await service.issue('user-1');
    expect(expiresIn).toBe(60);
    expect(await service.verify(token)).toEqual({ id: 'user-1' });
  });

  it('rejects tokens signed with another secret', async () => {
    const other = createTokenService({ secret: 'y'.repeat(40), ttlSeconds: 60 });
    const { token } = await other.issue('user-1');
    await expect(service.verify(token)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('rejects tampered and garbage tokens', async () => {
    const { token } = await service.issue('user-1');
    const [header, payload, signature] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'admin' })).toString('base64url');

    await expect(service.verify(`${header}.${forgedPayload}.${signature}`)).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
    await expect(service.verify(`${header}.${payload}`)).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
    await expect(service.verify('garbage')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('rejects unsigned tokens (alg=none)', async () => {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'none' })}.${encode({ sub: 'user-1' })}.`;
    await expect(service.verify(unsigned)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('reports expiry distinctly so clients know to sign in again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { token } = await service.issue('user-1');

    vi.setSystemTime(Date.now() + 61_000);
    await expect(service.verify(token)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });
});

describe('AuthService', () => {
  const build = () => {
    const users = createInMemoryUserStore();
    const hasher = createScryptPasswordHasher({ N: 1024, r: 8, p: 1 });
    const verify = vi.spyOn(hasher, 'verify');
    return { service: createAuthService({ users, hasher }), users, verify };
  };

  it('registers a user and never stores the plain password', async () => {
    const { service, users } = build();
    const user = await service.register('a@example.com', 'password-123');

    expect(user.passwordHash).not.toContain('password-123');
    expect(users.users.size).toBe(1);
  });

  it('rejects a duplicate email regardless of letter case', async () => {
    const { service } = build();
    await service.register('a@example.com', 'password-123');
    await expect(service.register('A@Example.com', 'password-456')).rejects.toMatchObject({
      statusCode: 409,
      code: 'EMAIL_TAKEN',
    });
  });

  it('logs in with the right password', async () => {
    const { service } = build();
    const registered = await service.register('a@example.com', 'password-123');
    expect((await service.login('a@example.com', 'password-123')).id).toBe(registered.id);
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const { service } = build();
    await service.register('a@example.com', 'password-123');

    const wrongPassword = await service.login('a@example.com', 'nope').catch((e) => e);
    const unknownEmail = await service.login('ghost@example.com', 'nope').catch((e) => e);

    expect(wrongPassword).toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
    expect(unknownEmail).toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
  });

  it('still performs a hash comparison for unknown emails (no timing side channel)', async () => {
    const { service, verify } = build();
    await service.login('ghost@example.com', 'nope').catch(() => undefined);
    expect(verify).toHaveBeenCalledTimes(1);
  });
});
