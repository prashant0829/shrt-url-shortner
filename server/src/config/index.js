import path from 'node:path';
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const positiveInt = (fallback) => z.coerce.number().int().positive().default(fallback);

/** Raw environment variables: validated once at startup so misconfiguration fails fast. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  BASE_URL: z.url({ protocol: /^https?$/ }).default('http://localhost:8080'),
  // Number of reverse proxies in front of the app (0 = none). Express then takes the client
  // address from that many X-Forwarded-For entries counted from the right, so a client cannot spoof it.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  CORS_ORIGINS: csv,
  /** Directory with the built React app. Defaults to server/public (where `npm run build` writes it). */
  WEB_DIR: z.string().min(1).optional(),
  BLOCKED_DOMAINS: csv,

  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: positiveInt(10),
  REDIS_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_TTL_SECONDS: positiveInt(3600),
  VISITOR_HASH_SECRET: z.string().min(16, 'must be at least 16 characters'),
  GEO_COUNTRY_HEADER: z.string().min(1).default('cf-ipcountry'),

  LINK_CACHE_TTL_SECONDS: positiveInt(3600),
  LINK_NEGATIVE_CACHE_TTL_SECONDS: positiveInt(60),

  CLICK_STREAM_KEY: z.string().min(1).default('clicks'),
  CLICK_STREAM_MAX_LEN: positiveInt(100_000),
  CLICK_CONSUMER_GROUP: z.string().min(1).default('click-workers'),
  WORKER_BATCH_SIZE: positiveInt(500),
  WORKER_BLOCK_MS: positiveInt(2000),
  WORKER_RECLAIM_IDLE_MS: positiveInt(60_000),
  /** If set, the worker touches this file after every successful poll (used by container health checks). */
  WORKER_HEARTBEAT_FILE: z.string().min(1).optional(),

  RATE_LIMIT_ENABLED: z.stringbool().default(true),
  RATE_LIMIT_API_PER_MINUTE: positiveInt(300),
  RATE_LIMIT_CREATE_ANON_PER_MINUTE: positiveInt(20),
  RATE_LIMIT_CREATE_USER_PER_MINUTE: positiveInt(120),
  RATE_LIMIT_AUTH_PER_MINUTE: positiveInt(10),
});

/**
 * Typed, grouped view of the environment that the rest of the code base depends on.
 * @typedef {object} Config
 * @property {'development' | 'test' | 'production'} env
 * @property {boolean} isProduction
 * @property {{host: string, port: number, baseUrl: string, trustProxyHops: number, corsOrigins: string[], webDir: string}} server
 *   `baseUrl` is the public origin without a trailing slash, e.g. `https://sho.rt`.
 * @property {{level: string}} log
 * @property {{url: string, poolMax: number}} db
 * @property {{url: string}} redis
 * @property {{jwtSecret: string, jwtTtlSeconds: number}} auth
 * @property {{blockedDomains: string[], cacheTtlSeconds: number, negativeCacheTtlSeconds: number}} links
 * @property {{streamKey: string, streamMaxLen: number, consumerGroup: string, visitorHashSecret: string,
 *   countryHeader: string, batchSize: number, blockMs: number, reclaimIdleMs: number, heartbeatFile?: string}} clicks
 * @property {{enabled: boolean, apiPerMinute: number, createAnonPerMinute: number,
 *   createUserPerMinute: number, authPerMinute: number}} rateLimit
 */

export class ConfigError extends Error {}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {Config}
 * @throws {ConfigError} listing every invalid variable
 */
export function loadConfig(env = process.env) {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new ConfigError(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  const e = result.data;

  return {
    env: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    server: {
      host: e.HOST,
      port: e.PORT,
      baseUrl: e.BASE_URL.replace(/\/+$/, ''),
      trustProxyHops: e.TRUST_PROXY_HOPS,
      corsOrigins: e.CORS_ORIGINS,
      webDir: e.WEB_DIR ?? path.resolve(import.meta.dirname, '../../public'),
    },
    log: { level: e.LOG_LEVEL },
    db: { url: e.DATABASE_URL, poolMax: e.DB_POOL_MAX },
    redis: { url: e.REDIS_URL },
    auth: { jwtSecret: e.JWT_SECRET, jwtTtlSeconds: e.JWT_TTL_SECONDS },
    links: {
      blockedDomains: e.BLOCKED_DOMAINS,
      cacheTtlSeconds: e.LINK_CACHE_TTL_SECONDS,
      negativeCacheTtlSeconds: e.LINK_NEGATIVE_CACHE_TTL_SECONDS,
    },
    clicks: {
      streamKey: e.CLICK_STREAM_KEY,
      streamMaxLen: e.CLICK_STREAM_MAX_LEN,
      consumerGroup: e.CLICK_CONSUMER_GROUP,
      visitorHashSecret: e.VISITOR_HASH_SECRET,
      countryHeader: e.GEO_COUNTRY_HEADER.toLowerCase(),
      batchSize: e.WORKER_BATCH_SIZE,
      blockMs: e.WORKER_BLOCK_MS,
      reclaimIdleMs: e.WORKER_RECLAIM_IDLE_MS,
      heartbeatFile: e.WORKER_HEARTBEAT_FILE,
    },
    rateLimit: {
      enabled: e.RATE_LIMIT_ENABLED,
      apiPerMinute: e.RATE_LIMIT_API_PER_MINUTE,
      createAnonPerMinute: e.RATE_LIMIT_CREATE_ANON_PER_MINUTE,
      createUserPerMinute: e.RATE_LIMIT_CREATE_USER_PER_MINUTE,
      authPerMinute: e.RATE_LIMIT_AUTH_PER_MINUTE,
    },
  };
}
