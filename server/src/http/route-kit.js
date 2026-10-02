import express from 'express';
import { validate } from './validate.js';

// Bodies here are tiny JSON documents; a small cap blunts oversized-payload abuse.
const JSON_BODY_LIMIT = '16kb';

/**
 * Every route is declared once, with its security, rate limit, input schemas and documentation.
 * The kit turns that declaration into the Express middleware chain *and* records it for the
 * OpenAPI document, so validation, behaviour and docs cannot drift apart.
 *
 * @typedef {object} RouteDefinition
 * @property {'get' | 'post' | 'patch' | 'delete'} method
 * @property {string} path Relative to the router prefix, e.g. `/links/:code`.
 * @property {'none' | 'optional' | 'required'} [security]
 *   `optional`: a token is honoured if sent (and rejected if invalid). `required`: anonymous callers get 401.
 * @property {import('express').RequestHandler | false} [limit]
 *   Rate limiter for this route. Omit to use the router default; `false` for none.
 * @property {{params?: import('zod').ZodType, query?: import('zod').ZodType, body?: import('zod').ZodType}} [request]
 *   Validated input, also used as documentation. Parsed values are available as `req.input`.
 * @property {Record<number, import('zod').ZodType | null | object>} [responses]
 *   Documentation only: status code -> zod schema (JSON), `null` (no body) or `binaryResponse(...)`.
 * @property {string[]} [tags]
 * @property {string} [summary]
 * @property {string} [description]
 * @property {boolean} [hidden] Omit from the documentation.
 * @property {import('express').RequestHandler} handler
 */

export function createRouteRegistry() {
  const routes = [];
  return { routes, add: (route) => routes.push(route) };
}

/**
 * @param {object} deps
 * @param {{routes: object[], add: (route: object) => void}} deps.registry
 * @param {ReturnType<typeof import('./middleware/auth.js').createAuthMiddleware>} deps.auth
 */
export function createRouteKit({ registry, auth }) {
  /**
   * @param {string} [prefix] Mount path the router will be attached at (used for documentation).
   * @param {{defaultLimit?: import('express').RequestHandler}} [options]
   */
  return function createRouter(prefix = '', { defaultLimit } = {}) {
    const router = express.Router();

    /** @param {RouteDefinition} definition */
    function route(definition) {
      const {
        method,
        path,
        security = 'none',
        limit = defaultLimit,
        request = {},
        responses = {},
        handler,
        ...docs
      } = definition;

      // Order matters: identify the caller -> rate limit -> reject bad tokens -> require a user
      // -> parse the body -> validate -> handle. Cheap rejections come first.
      const chain = [];
      if (security !== 'none') chain.push(auth.identify);
      if (limit) chain.push(limit);
      if (security !== 'none') chain.push(auth.rejectInvalidToken);
      if (security === 'required') chain.push(auth.requireAuth);
      if (request.body) chain.push(express.json({ limit: JSON_BODY_LIMIT }));
      if (request.params || request.query || request.body) chain.push(validate(request));

      router[method](path, ...chain, handler);
      registry.add({ method, path: `${prefix}${path}`, security, request, responses, ...docs });
    }

    return { router, route };
  };
}
