import { BEARER_SCHEME, ErrorCode, HttpHeader } from '../constants.js';
import { isUnauthorizedError, unauthorizedError } from '../errors.js';

// Authentication runs in three steps so rate limiting can sit between them:
//   identify            who is calling? Never rejects, so the limiter can budget per account.
//   rejectInvalidToken  a token that was sent but is bad is an error, even on public routes;
//                       treating it as anonymous would hide expired sessions from the client.
//   requireAuth         protected routes only: anonymous callers get 401.
// Rejecting after the limiter means bad-token requests cannot be replayed for free.
export function createAuthMiddleware(tokenService) {
  async function authenticate(authorizationHeader) {
    const [scheme, token] = authorizationHeader.split(' ');
    if (scheme?.toLowerCase() !== BEARER_SCHEME || !token) {
      throw unauthorizedError(
        ErrorCode.INVALID_TOKEN,
        'Expected an "Authorization: Bearer <token>" header',
      );
    }
    return tokenService.verify(token);
  }

  async function identify(req, _res, next) {
    req.auth = { user: null, error: null };

    const authorizationHeader = req.headers[HttpHeader.AUTHORIZATION];
    if (authorizationHeader) {
      try {
        req.auth.user = await authenticate(authorizationHeader);
      } catch (err) {
        req.auth.error = isUnauthorizedError(err)
          ? err
          : unauthorizedError(ErrorCode.INVALID_TOKEN, 'Invalid token');
      }
    }
    next();
  }

  const rejectInvalidToken = (req, _res, next) => next(req.auth.error ?? undefined);

  const requireAuth = (req, _res, next) => next(req.auth.user ? undefined : unauthorizedError());

  return { identify, rejectInvalidToken, requireAuth };
}

// Only call this inside routes declared with `RouteSecurity.REQUIRED`.
export function currentUser(req) {
  if (!req.auth?.user) throw unauthorizedError();
  return req.auth.user;
}
