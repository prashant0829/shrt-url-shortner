// Fixed values shared across the client. Enums are frozen objects, so code reads
// `AsyncStatus.READY` instead of 'ready'.

// ---- Time ------------------------------------------------------------------------------------
export const ONE_SECOND_MS = 1_000;
export const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;
export const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
export const ONE_DAY_MS = 24 * ONE_HOUR_MS;

// ---- API -------------------------------------------------------------------------------------
export const API_BASE_URL = '/api/v1';
export const API_DOCS_PATH = '/docs';
export const JSON_CONTENT_TYPE = 'application/json';

export const HttpStatus = Object.freeze({
  NO_CONTENT: 204,
});

export const HttpHeader = Object.freeze({
  AUTHORIZATION: 'authorization',
  CONTENT_TYPE: 'content-type',
});

export const ApiErrorCode = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INVALID_TOKEN: 'INVALID_TOKEN',
});

// Error codes that mean "your session is no longer valid", as opposed to a wrong password.
export const SESSION_ERROR_CODES = Object.freeze([
  ApiErrorCode.TOKEN_EXPIRED,
  ApiErrorCode.INVALID_TOKEN,
]);

// ---- Session ---------------------------------------------------------------------------------
export const TOKEN_STORAGE_KEY = 'shrt.token';

// ---- UI states -------------------------------------------------------------------------------
export const AsyncStatus = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
});

export const AuthMode = Object.freeze({
  LOGIN: 'login',
  REGISTER: 'register',
});

export const ToastKind = Object.freeze({
  INFO: 'info',
  ERROR: 'error',
});

export const LinkStatus = Object.freeze({
  ACTIVE: 'active',
  DISABLED: 'disabled',
  EXPIRED: 'expired',
});

// ---- Analytics -------------------------------------------------------------------------------
export const AnalyticsInterval = Object.freeze({
  HOUR: 'hour',
  DAY: 'day',
});

export const AnalyticsRange = Object.freeze({
  LAST_24_HOURS: '24h',
  LAST_7_DAYS: '7d',
  LAST_30_DAYS: '30d',
});

// The time ranges offered in the analytics view, and the bucket size each one uses.
export const ANALYTICS_RANGES = Object.freeze({
  [AnalyticsRange.LAST_24_HOURS]: {
    label: '24 hours',
    interval: AnalyticsInterval.HOUR,
    ms: ONE_DAY_MS,
  },
  [AnalyticsRange.LAST_7_DAYS]: {
    label: '7 days',
    interval: AnalyticsInterval.DAY,
    ms: 7 * ONE_DAY_MS,
  },
  [AnalyticsRange.LAST_30_DAYS]: {
    label: '30 days',
    interval: AnalyticsInterval.DAY,
    ms: 30 * ONE_DAY_MS,
  },
});

export const DEFAULT_ANALYTICS_RANGE = AnalyticsRange.LAST_7_DAYS;

// ---- Limits and timings ----------------------------------------------------------------------
export const LINKS_PAGE_SIZE = 20;
export const SEARCH_DEBOUNCE_MS = 300;
export const TOAST_DISMISS_MS = 4_500;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_ALIAS_LENGTH = 32;
export const DEFAULT_QR_SIZE = 240;
export const QR_PREVIEW_SIZE = 96;
