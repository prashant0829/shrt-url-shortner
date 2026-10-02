import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/index.js';
import { decodeCursor, encodeCursor } from '../../src/modules/links/pagination.js';
import { SingleFlight } from '../../src/shared/single-flight.js';

const REQUIRED_ENV = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379/0',
  JWT_SECRET: 'a'.repeat(32),
  VISITOR_HASH_SECRET: 'b'.repeat(16),
};

describe('loadConfig', () => {
  it('applies defaults and groups settings', () => {
    const config = loadConfig(REQUIRED_ENV);

    expect(config.env).toBe('development');
    expect(config.server).toMatchObject({ port: 8080, trustProxyHops: 0, corsOrigins: [] });
    expect(config.rateLimit.enabled).toBe(true);
    expect(config.clicks.countryHeader).toBe('cf-ipcountry');
  });

  it('coerces numbers and booleans and splits lists', () => {
    const config = loadConfig({
      ...REQUIRED_ENV,
      NODE_ENV: 'production',
      PORT: '9000',
      TRUST_PROXY_HOPS: '1',
      RATE_LIMIT_ENABLED: 'false',
      CORS_ORIGINS: 'https://a.com, https://b.com ,',
      BLOCKED_DOMAINS: 'evil.com',
    });

    expect(config.isProduction).toBe(true);
    expect(config.server.port).toBe(9000);
    expect(config.server.trustProxyHops).toBe(1);
    expect(config.rateLimit.enabled).toBe(false);
    expect(config.server.corsOrigins).toEqual(['https://a.com', 'https://b.com']);
    expect(config.links.blockedDomains).toEqual(['evil.com']);
  });

  it('treats the worker heartbeat file as optional', () => {
    expect(loadConfig(REQUIRED_ENV).clicks.heartbeatFile).toBeUndefined();
    expect(
      loadConfig({ ...REQUIRED_ENV, WORKER_HEARTBEAT_FILE: '/tmp/beat' }).clicks.heartbeatFile,
    ).toBe('/tmp/beat');
  });

  it('strips trailing slashes from BASE_URL', () => {
    expect(loadConfig({ ...REQUIRED_ENV, BASE_URL: 'https://sho.rt//' }).server.baseUrl).toBe(
      'https://sho.rt',
    );
  });

  it('fails fast and lists every problem', () => {
    expect(() => loadConfig({ JWT_SECRET: 'short' })).toThrow(ConfigError);
    try {
      loadConfig({ JWT_SECRET: 'short', PORT: '99999' });
    } catch (err) {
      const message = err.message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('JWT_SECRET');
      expect(message).toContain('PORT');
    }
  });

  it('rejects non-http BASE_URL values', () => {
    expect(() => loadConfig({ ...REQUIRED_ENV, BASE_URL: 'ftp://sho.rt' })).toThrow(ConfigError);
  });
});

describe('cursor pagination helpers', () => {
  it('round-trips ids', () => {
    expect(decodeCursor(encodeCursor(12345))).toBe(12345);
  });

  it.each([
    '',
    '!!!',
    Buffer.from('abc').toString('base64url'),
    Buffer.from('-5').toString('base64url'),
  ])('rejects invalid cursor %j', (cursor) => {
    expect(() => decodeCursor(cursor)).toThrow(/cursor/i);
  });
});

describe('SingleFlight', () => {
  it('runs one task for concurrent callers with the same key', async () => {
    const flight = new SingleFlight();
    let runs = 0;
    const task = async () => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 42;
    };

    const results = await Promise.all([
      flight.run('k', task),
      flight.run('k', task),
      flight.run('k', task),
    ]);

    expect(results).toEqual([42, 42, 42]);
    expect(runs).toBe(1);
  });

  it('does not share work across different keys', async () => {
    const flight = new SingleFlight();
    const [a, b] = await Promise.all([
      flight.run('a', async () => 'A'),
      flight.run('b', async () => 'B'),
    ]);
    expect([a, b]).toEqual(['A', 'B']);
  });

  it('runs again once the previous call has settled', async () => {
    const flight = new SingleFlight();
    let runs = 0;
    const task = async () => ++runs;

    await flight.run('k', task);
    await flight.run('k', task);
    expect(runs).toBe(2);
  });

  it('propagates failures to every waiter and then recovers', async () => {
    const flight = new SingleFlight();
    const failing = async () => {
      throw new Error('boom');
    };

    const outcomes = await Promise.allSettled([flight.run('k', failing), flight.run('k', failing)]);
    expect(outcomes.map((o) => o.status)).toEqual(['rejected', 'rejected']);
    await expect(flight.run('k', async () => 7)).resolves.toBe(7);
  });
});
