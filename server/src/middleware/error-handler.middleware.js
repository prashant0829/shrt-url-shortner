import { ErrorCode, HttpHeader, HttpStatus } from '../constants.js';
import { isAppError } from '../errors.js';

// Errors raised by express.json() for bad request bodies, keyed by `err.type`.
const BODY_PARSER_ERRORS = {
  'entity.parse.failed': {
    status: HttpStatus.BAD_REQUEST,
    code: ErrorCode.INVALID_JSON,
    message: 'The request body is not valid JSON',
  },
  'entity.too.large': {
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    code: ErrorCode.PAYLOAD_TOO_LARGE,
    message: 'The request body is too large',
  },
  'encoding.unsupported': {
    status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    code: ErrorCode.UNSUPPORTED_ENCODING,
    message: 'The request encoding is not supported',
  },
  'charset.unsupported': {
    status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    code: ErrorCode.UNSUPPORTED_CHARSET,
    message: 'The request charset is not supported',
  },
};

const isClientErrorStatus = (status) =>
  Number.isInteger(status) &&
  status >= HttpStatus.BAD_REQUEST &&
  status < HttpStatus.INTERNAL_SERVER_ERROR;

// Maps every kind of failure onto one response shape. Details of unexpected errors stay out of the body.
function toErrorResponse(err) {
  if (isAppError(err)) {
    return {
      status: err.statusCode,
      code: err.code,
      message: err.message,
      details: err.details,
      retryAfterSeconds: err.retryAfterSeconds,
    };
  }

  const bodyParserError = BODY_PARSER_ERRORS[err?.type];
  if (bodyParserError) return bodyParserError;

  // Other client errors raised by Express or its middleware, such as a malformed %-escape in the URL.
  if (isClientErrorStatus(err?.status)) {
    return {
      status: err.status,
      code: ErrorCode.BAD_REQUEST,
      message: 'The request could not be processed',
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: ErrorCode.INTERNAL_ERROR,
    message: 'An unexpected error occurred',
  };
}

const errorBody = (req, { code, message, details }) => ({
  error: { code, message, details },
  requestId: req.id,
});

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const response = toErrorResponse(err);
  if (response.status >= HttpStatus.INTERNAL_SERVER_ERROR) req.log.error({ err }, 'request failed');
  if (response.retryAfterSeconds) {
    res.set(HttpHeader.RETRY_AFTER, String(response.retryAfterSeconds));
  }

  return res.status(response.status).json(errorBody(req, response));
}

export function notFoundHandler(req, res) {
  res.status(HttpStatus.NOT_FOUND).json(
    errorBody(req, {
      code: ErrorCode.ROUTE_NOT_FOUND,
      message: `Route ${req.method} ${req.path} not found`,
    }),
  );
}
