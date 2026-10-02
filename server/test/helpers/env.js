/** Integration tests use dedicated stores so they can never touch development data. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://shortener:shortener@localhost:5432/urlshortener_test';

/** Redis logical database 15; the helpers refuse to flush database 0. */
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';

export const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  BASE_URL: 'http://short.test',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: TEST_REDIS_URL,
  JWT_SECRET: 'test-jwt-secret-test-jwt-secret-1234',
  VISITOR_HASH_SECRET: 'test-visitor-secret',
  // Most suites are not about throttling; the platform suite switches it on explicitly.
  RATE_LIMIT_ENABLED: 'false',
  // One trusted hop lets tests simulate distinct client IPs through X-Forwarded-For.
  TRUST_PROXY_HOPS: '1',
};
