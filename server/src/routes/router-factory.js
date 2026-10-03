import express from 'express';
import { JSON_BODY_LIMIT, RouteSecurity } from '../constants.js';
import { validate } from '../middleware/validate.middleware.js';

// Collects every declared route so the OpenAPI document can be generated from the same declarations.
export function createRouteRegistry() {
  const routes = [];
  return { routes, add: (route) => routes.push(route) };
}

// A route is declared once with its security, rate limiter, input schemas and docs. The factory turns
// that declaration into the Express middleware chain and records it for the OpenAPI document.
export function createRouterFactory({ routeRegistry, authMiddleware }) {
  return function createRouter(pathPrefix = '', { defaultRateLimiter } = {}) {
    const router = express.Router();

    function route({
      method,
      path,
      security = RouteSecurity.NONE,
      rateLimiter = defaultRateLimiter,
      request = {},
      responses = {},
      handler,
      ...docs
    }) {
      // Cheap rejections come first: identify the caller, rate limit, reject bad tokens, require a
      // user, and only then parse and validate the body.
      const middlewares = [];
      if (security !== RouteSecurity.NONE) middlewares.push(authMiddleware.identify);
      if (rateLimiter) middlewares.push(rateLimiter);
      if (security !== RouteSecurity.NONE) middlewares.push(authMiddleware.rejectInvalidToken);
      if (security === RouteSecurity.REQUIRED) middlewares.push(authMiddleware.requireAuth);
      if (request.body) middlewares.push(express.json({ limit: JSON_BODY_LIMIT }));
      if (request.params || request.query || request.body) middlewares.push(validate(request));

      router[method](path, ...middlewares, handler);
      routeRegistry.add({
        method,
        path: `${pathPrefix}${path}`,
        security,
        request,
        responses,
        ...docs,
      });
    }

    return { router, route };
  };
}
