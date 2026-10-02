/**
 * Errors that carry an HTTP status and a stable machine-readable code.
 * The global error handler turns them into JSON responses; anything else becomes a generic 500.
 */
export class AppError extends Error {
  statusCode;
  code;
  details;

  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;

    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(code, message, details) {
    super(400, code, message, details);
  }
}

/** 400 with one entry per invalid field: `[{ in, path, message }]`. */
export class ValidationError extends AppError {
  constructor(details) {
    super(400, 'VALIDATION_ERROR', 'Request validation failed', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(code = 'UNAUTHORIZED', message = 'Authentication required') {
    super(401, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(code = 'NOT_FOUND', message = 'Resource not found') {
    super(404, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(code, message) {
    super(409, code, message);
  }
}

export class GoneError extends AppError {
  constructor(code = 'GONE', message = 'This link is no longer available') {
    super(410, code, message);
  }
}

export class TooManyRequestsError extends AppError {
  retryAfterSeconds;

  constructor(retryAfterSeconds) {
    super(429, 'RATE_LIMITED', `Too many requests. Retry in ${retryAfterSeconds}s.`);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(code, message) {
    super(503, code, message);
  }
}
