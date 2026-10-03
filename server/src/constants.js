// Fixed values shared across the server. Enums are frozen objects, so code reads
// `HttpStatus.NOT_FOUND` instead of 404 and `ErrorCode.LINK_GONE` instead of 'LINK_GONE'.

// ---- Time ------------------------------------------------------------------------------------
export const ONE_SECOND_MS = 1_000;
export const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;
export const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
export const ONE_DAY_MS = 24 * ONE_HOUR_MS;

// ---- Application -----------------------------------------------------------------------------
export const SERVICE_NAME = 'url-shortener';

export const Environment = Object.freeze({
  DEVELOPMENT: 'development',
  TEST: 'test',
  PRODUCTION: 'production',
});

export const LOG_LEVELS = Object.freeze([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
]);

// Longer than typical load-balancer idle timeouts (60 s), so keep-alive sockets are not reset.
export const KEEP_ALIVE_TIMEOUT_MS = 65 * ONE_SECOND_MS;
export const HEADERS_TIMEOUT_MS = KEEP_ALIVE_TIMEOUT_MS + ONE_SECOND_MS;
export const REQUEST_TIMEOUT_MS = 30 * ONE_SECOND_MS;
export const SHUTDOWN_TIMEOUT_MS = 15 * ONE_SECOND_MS;
export const HEALTH_CHECK_TIMEOUT_MS = 1_500;

// ---- HTTP ------------------------------------------------------------------------------------
export const HttpStatus = Object.freeze({
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  FOUND: 302,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
});

export const HttpMethod = Object.freeze({
  GET: 'get',
  POST: 'post',
  PATCH: 'patch',
  DELETE: 'delete',
});

export const HttpHeader = Object.freeze({
  AUTHORIZATION: 'authorization',
  CACHE_CONTROL: 'cache-control',
  CONNECTION: 'connection',
  LOCATION: 'location',
  REFERER: 'referer',
  REQUEST_ID: 'x-request-id',
  RETRY_AFTER: 'retry-after',
  USER_AGENT: 'user-agent',
});

export const ContentType = Object.freeze({
  JSON: 'application/json',
  HTML: 'text/html; charset=utf-8',
  PNG: 'image/png',
  SVG: 'image/svg+xml',
});

export const CacheControl = Object.freeze({
  NO_STORE: 'no-store',
  REVALIDATE: 'no-cache',
  PUBLIC_ONE_HOUR: 'public, max-age=3600',
});

export const BEARER_SCHEME = 'bearer';
export const JSON_BODY_LIMIT = '16kb';

// ---- Routes ----------------------------------------------------------------------------------
export const RoutePath = Object.freeze({
  API_PREFIX: '/api/v1',
  DOCS: '/docs',
  DOCS_JSON: '/docs/json',
  METRICS: '/metrics',
  HEALTH_PREFIX: '/health/',
  HEALTH_LIVE: '/health/live',
  HEALTH_READY: '/health/ready',
});

/** How a route treats the Authorization header. */
export const RouteSecurity = Object.freeze({
  NONE: 'none',
  OPTIONAL: 'optional',
  REQUIRED: 'required',
});

export const ApiTag = Object.freeze({
  AUTH: 'Auth',
  LINKS: 'Links',
  ANALYTICS: 'Analytics',
  SYSTEM: 'System',
});

// ---- Error codes (the `error.code` field of every error response) ----------------------------
export const ErrorCode = Object.freeze({
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_JSON: 'INVALID_JSON',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_ENCODING: 'UNSUPPORTED_ENCODING',
  UNSUPPORTED_CHARSET: 'UNSUPPORTED_CHARSET',

  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_TAKEN: 'EMAIL_TAKEN',

  NOT_FOUND: 'NOT_FOUND',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  LINK_NOT_FOUND: 'LINK_NOT_FOUND',
  GONE: 'GONE',
  LINK_GONE: 'LINK_GONE',

  INVALID_URL: 'INVALID_URL',
  INVALID_EXPIRY: 'INVALID_EXPIRY',
  INVALID_CURSOR: 'INVALID_CURSOR',
  INVALID_RANGE: 'INVALID_RANGE',
  RANGE_TOO_LARGE: 'RANGE_TOO_LARGE',
  ALIAS_TAKEN: 'ALIAS_TAKEN',
  ALIAS_RESERVED: 'ALIAS_RESERVED',
  CODE_GENERATION_FAILED: 'CODE_GENERATION_FAILED',

  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

// ---- Rate limiting ---------------------------------------------------------------------------
export const RateLimiterName = Object.freeze({
  API: 'api',
  AUTH: 'auth',
  CREATE_LINK: 'create-link',
});

export const RATE_LIMIT_WINDOW_MS = ONE_MINUTE_MS;

// ---- Redis -----------------------------------------------------------------------------------
export const LINK_CACHE_KEY_PREFIX = 'link:';
export const RATE_LIMIT_KEY_PREFIX = 'rl:';
export const CLICK_EVENT_FIELD = 'event';

/** Random extra lifetime (up to this share of the TTL) so entries written together do not expire together. */
export const CACHE_TTL_JITTER_RATIO = 0.1;

export const RedisConnectionRole = Object.freeze({
  REQUEST: 'request',
  BLOCKING: 'blocking',
});

// ---- Short links -----------------------------------------------------------------------------
export const SHORT_CODE_LENGTH = 7;
export const SHORT_CODE_MIN_LENGTH = 3;
export const SHORT_CODE_MAX_LENGTH = 32;
export const SHORT_CODE_PATTERN = new RegExp(
  `^[A-Za-z0-9_-]{${SHORT_CODE_MIN_LENGTH},${SHORT_CODE_MAX_LENGTH}}$`,
);
export const MAX_CODE_GENERATION_ATTEMPTS = 5;

/** Paths the application serves itself, plus words that would look official. */
export const RESERVED_SHORT_CODES = Object.freeze([
  'api',
  'docs',
  'health',
  'metrics',
  'assets',
  'static',
  'admin',
  'login',
  'logout',
  'register',
  'signup',
  'app',
  'www',
]);

export const RedirectOutcome = Object.freeze({
  REDIRECT: 'redirect',
  GONE: 'gone',
  NOT_FOUND: 'not_found',
});

export const CacheLookupResult = Object.freeze({
  HIT: 'hit',
  NEGATIVE_HIT: 'negative_hit',
  MISS: 'miss',
});

// ---- Input limits ----------------------------------------------------------------------------
export const MAX_URL_LENGTH = 2_048;
export const MAX_EMAIL_LENGTH = 254;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export const DEFAULT_LINKS_PAGE_SIZE = 20;
export const MAX_LINKS_PAGE_SIZE = 100;
export const MAX_SEARCH_LENGTH = 100;
export const MAX_PAGINATION_CURSOR_LENGTH = 64;
export const MAX_CODE_PARAM_LENGTH = 64;
export const WEB_PROTOCOLS = Object.freeze(['http:', 'https:']);

export const QrFormat = Object.freeze({
  PNG: 'png',
  SVG: 'svg',
});
export const MIN_QR_SIZE = 64;
export const MAX_QR_SIZE = 1_024;
export const DEFAULT_QR_SIZE = 256;

// ---- Clicks and analytics --------------------------------------------------------------------
export const ClickEnqueueResult = Object.freeze({
  OK: 'ok',
  ERROR: 'error',
});

export const DeviceType = Object.freeze({
  DESKTOP: 'desktop',
  MOBILE: 'mobile',
  TABLET: 'tablet',
  TV: 'tv',
  UNKNOWN: 'unknown',
});

export const AnalyticsInterval = Object.freeze({
  HOUR: 'hour',
  DAY: 'day',
});

export const ANALYTICS_INTERVAL_MS = Object.freeze({
  [AnalyticsInterval.HOUR]: ONE_HOUR_MS,
  [AnalyticsInterval.DAY]: ONE_DAY_MS,
});

export const DEFAULT_ANALYTICS_RANGE_MS = 7 * ONE_DAY_MS;
export const MAX_ANALYTICS_BUCKETS = 1_000;
export const BREAKDOWN_ROW_LIMIT = 10;

export const MAX_USER_AGENT_LENGTH = 512;
export const MAX_REFERRER_LENGTH = 2_048;
export const MAX_VISITOR_HASH_LENGTH = 64;
export const VISITOR_HASH_LENGTH = 22;
export const COUNTRY_CODE_LENGTH = 2;

// ---- Health ----------------------------------------------------------------------------------
export const HealthStatus = Object.freeze({
  OK: 'ok',
  DEGRADED: 'degraded',
});

export const DependencyStatus = Object.freeze({
  UP: 'up',
  DOWN: 'down',
});
