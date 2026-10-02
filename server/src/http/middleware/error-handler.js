import { AppError, TooManyRequestsError } from '../../shared/errors.js';

// Errors raised by express.json() for bad request bodies, keyed by `err.type`.
const BODY_ERRORS = {
  'entity.parse.failed': [400, 'INVALID_JSON', 'The request body is not valid JSON'],
  'entity.too.large': [413, 'PAYLOAD_TOO_LARGE', 'The request body is too large'],
  'encoding.unsupported': [415, 'UNSUPPORTED_ENCODING', 'The request encoding is not supported'],
  'charset.unsupported': [415, 'UNSUPPORTED_CHARSET', 'The request charset is not supported'],
};

/** Maps every kind of failure onto one response shape and keeps internals out of 5xx bodies. */
function describe(err) {
  if (err instanceof AppError) {
    return {
      status: err.statusCode,
      code: err.code,
      message: err.message,
      details: err.details,
      retryAfterSeconds: err instanceof TooManyRequestsError ? err.retryAfterSeconds : undefined,
    };
  }

  const known = BODY_ERRORS[err?.type];
  if (known) {
    const [status, code, message] = known;
    return { status, code, message };
  }

  // Other client errors raised by Express or its middleware (e.g. a malformed %-escape in the URL).
  if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 500) {
    return {
      status: err.status,
      code: 'BAD_REQUEST',
      message: 'The request could not be processed',
    };
  }

  return { status: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
}

/** The `{ error, requestId }` body every error response uses. */
const body = (req, { code, message, details }) => ({
  error: { code, message, details },
  requestId: req.id,
});

/** Express error middleware (four parameters: Express identifies it by its arity). */
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const result = describe(err);
  if (result.status >= 500) req.log.error({ err }, 'request failed');
  if (result.retryAfterSeconds) res.set('retry-after', String(result.retryAfterSeconds));

  return res.status(result.status).json(body(req, result));
}

/** Terminal middleware for requests no route matched. */
export function notFoundHandler(req, res) {
  res.status(404).json(
    body(req, {
      code: 'ROUTE_NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    }),
  );
}
