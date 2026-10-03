import { ErrorCode, HttpStatus } from './constants.js';

const APP_ERROR_MARKER = Symbol('appError');

// An error with an HTTP status and a stable machine-readable code. The error handler turns it
// into the JSON response.
export function createAppError({ name = 'AppError', statusCode, code, message, details }) {
  const error = new Error(message);
  error.name = name;
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  error[APP_ERROR_MARKER] = true;
  return error;
}

export const isAppError = (value) => value instanceof Error && value[APP_ERROR_MARKER] === true;

export const isUnauthorizedError = (value) =>
  isAppError(value) && value.statusCode === HttpStatus.UNAUTHORIZED;

// Builds an error factory such as `notFoundError(code, message)`. `defaults` fill in a missing
// code or message.
const errorFactory =
  (name, statusCode, defaults = {}) =>
  (code = defaults.code, message = defaults.message, details) =>
    createAppError({ name, statusCode, code, message, details });

export const badRequestError = errorFactory('BadRequestError', HttpStatus.BAD_REQUEST);
export const conflictError = errorFactory('ConflictError', HttpStatus.CONFLICT);
export const serviceUnavailableError = errorFactory(
  'ServiceUnavailableError',
  HttpStatus.SERVICE_UNAVAILABLE,
);

export const unauthorizedError = errorFactory('UnauthorizedError', HttpStatus.UNAUTHORIZED, {
  code: ErrorCode.UNAUTHORIZED,
  message: 'Authentication required',
});

export const notFoundError = errorFactory('NotFoundError', HttpStatus.NOT_FOUND, {
  code: ErrorCode.NOT_FOUND,
  message: 'Resource not found',
});

export const goneError = errorFactory('GoneError', HttpStatus.GONE, {
  code: ErrorCode.GONE,
  message: 'This link is no longer available',
});

// `details` has one entry per invalid field: `[{ in, path, message }]`.
export const validationError = (details) =>
  createAppError({
    name: 'ValidationError',
    statusCode: HttpStatus.BAD_REQUEST,
    code: ErrorCode.VALIDATION_ERROR,
    message: 'Request validation failed',
    details,
  });

export function tooManyRequestsError(retryAfterSeconds) {
  const error = createAppError({
    name: 'TooManyRequestsError',
    statusCode: HttpStatus.TOO_MANY_REQUESTS,
    code: ErrorCode.RATE_LIMITED,
    message: `Too many requests. Retry in ${retryAfterSeconds}s.`,
  });
  error.retryAfterSeconds = retryAfterSeconds;
  return error;
}
