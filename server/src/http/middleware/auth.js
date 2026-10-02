import { UnauthorizedError } from '../../shared/errors.js';

/**
 * Authentication is split into three steps so that rate limiting can sit between them:
 *
 *   identify            -> who is calling? (never rejects, so the limiter can budget per account)
 *   [rate limiter]
 *   rejectInvalidToken  -> a token that was sent but is bad is an error, even on public routes:
 *                          treating it as anonymous would hide expired sessions from the client
 *   requireAuth         -> only for protected routes: anonymous callers get 401
 *
 * Doing the rejection after the limiter means bad-token requests cannot be replayed for free.
 *
 * @param {import('../../modules/auth/token-service.js').TokenService} tokens
 */
export function createAuthMiddleware(tokens) {
  /** Sets `req.auth = { user, error }`. */
  async function identify(req, _res, next) {
    req.auth = { user: null, error: null };

    const header = req.headers.authorization;
    if (header) {
      const [scheme, token] = header.split(' ');
      if (scheme?.toLowerCase() !== 'bearer' || !token) {
        req.auth.error = new UnauthorizedError(
          'INVALID_TOKEN',
          'Expected an "Authorization: Bearer <token>" header',
        );
      } else {
        try {
          req.auth.user = await tokens.verify(token);
        } catch (err) {
          req.auth.error =
            err instanceof UnauthorizedError
              ? err
              : new UnauthorizedError('INVALID_TOKEN', 'Invalid token');
        }
      }
    }
    next();
  }

  const rejectInvalidToken = (req, _res, next) => next(req.auth.error ?? undefined);

  const requireAuth = (req, _res, next) =>
    next(req.auth.user ? undefined : new UnauthorizedError());

  return { identify, rejectInvalidToken, requireAuth };
}

/** The authenticated user; only call inside routes declared with `security: 'required'`. */
export function currentUser(req) {
  if (!req.auth?.user) throw new UnauthorizedError();
  return req.auth.user;
}
