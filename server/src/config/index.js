import path from 'node:path';
import { z } from 'zod';
import { Environment, LOG_LEVELS } from '../constants.js';

const DEFAULT_WEB_DIR = path.resolve(import.meta.dirname, '../../public');

const commaSeparatedList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const positiveInt = (fallback) => z.coerce.number().int().positive().default(fallback);

// Validated once at startup, so a misconfiguration fails fast with every problem listed.
const envSchema = z.object({
  NODE_ENV: z.enum(Object.values(Environment)).default(Environment.DEVELOPMENT),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  BASE_URL: z.url({ protocol: /^https?$/ }).default('http://localhost:8080'),
  // Reverse proxies in front of the app (0 = none). The client IP is read from X-Forwarded-For,
  // counting that many entries from the right, so a client cannot spoof it.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  CORS_ORIGINS: commaSeparatedList,
  WEB_DIR: z.string().min(1).optional(),
  BLOCKED_DOMAINS: commaSeparatedList,

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
  WORKER_HEARTBEAT_FILE: z.string().min(1).optional(),

  RATE_LIMIT_ENABLED: z.stringbool().default(true),
  RATE_LIMIT_API_PER_MINUTE: positiveInt(300),
  RATE_LIMIT_CREATE_ANON_PER_MINUTE: positiveInt(20),
  RATE_LIMIT_CREATE_USER_PER_MINUTE: positiveInt(120),
  RATE_LIMIT_AUTH_PER_MINUTE: positiveInt(10),
});

function createConfigError(message) {
  const error = new Error(message);
  error.name = 'ConfigError';
  return error;
}

const isConfigError = (value) => value instanceof Error && value.name === 'ConfigError';

// Reads the environment into a grouped config object; throws a ConfigError listing every bad variable.
export function loadConfig(env = process.env) {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw createConfigError(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  const values = result.data;

  return {
    env: values.NODE_ENV,
    isProduction: values.NODE_ENV === Environment.PRODUCTION,
    server: {
      host: values.HOST,
      port: values.PORT,
      baseUrl: values.BASE_URL.replace(/\/+$/, ''),
      trustProxyHops: values.TRUST_PROXY_HOPS,
      corsOrigins: values.CORS_ORIGINS,
      webDir: values.WEB_DIR ?? DEFAULT_WEB_DIR,
    },
    log: { level: values.LOG_LEVEL },
    db: { url: values.DATABASE_URL, poolMax: values.DB_POOL_MAX },
    redis: { url: values.REDIS_URL },
    auth: { jwtSecret: values.JWT_SECRET, jwtTtlSeconds: values.JWT_TTL_SECONDS },
    links: {
      blockedDomains: values.BLOCKED_DOMAINS,
      cacheTtlSeconds: values.LINK_CACHE_TTL_SECONDS,
      negativeCacheTtlSeconds: values.LINK_NEGATIVE_CACHE_TTL_SECONDS,
    },
    clicks: {
      streamKey: values.CLICK_STREAM_KEY,
      streamMaxLen: values.CLICK_STREAM_MAX_LEN,
      consumerGroup: values.CLICK_CONSUMER_GROUP,
      visitorHashSecret: values.VISITOR_HASH_SECRET,
      countryHeader: values.GEO_COUNTRY_HEADER.toLowerCase(),
      batchSize: values.WORKER_BATCH_SIZE,
      blockMs: values.WORKER_BLOCK_MS,
      reclaimIdleMs: values.WORKER_RECLAIM_IDLE_MS,
      heartbeatFile: values.WORKER_HEARTBEAT_FILE,
    },
    rateLimit: {
      enabled: values.RATE_LIMIT_ENABLED,
      apiPerMinute: values.RATE_LIMIT_API_PER_MINUTE,
      createAnonPerMinute: values.RATE_LIMIT_CREATE_ANON_PER_MINUTE,
      createUserPerMinute: values.RATE_LIMIT_CREATE_USER_PER_MINUTE,
      authPerMinute: values.RATE_LIMIT_AUTH_PER_MINUTE,
    },
  };
}

// For process entry points: print the problems and exit, instead of crashing with a stack trace.
export function loadConfigOrExit() {
  try {
    return loadConfig();
  } catch (err) {
    if (!isConfigError(err)) throw err;
    console.error(err.message);
    process.exit(1);
  }
}
