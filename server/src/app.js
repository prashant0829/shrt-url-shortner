import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { createAuthMiddleware } from './http/middleware/auth.js';
import { errorHandler, notFoundHandler } from './http/middleware/error-handler.js';
import { httpMetrics } from './http/middleware/metrics.js';
import { createLimiterFactory } from './http/middleware/rate-limit.js';
import { requestContext } from './http/middleware/request-context.js';
import { securityMiddleware } from './http/middleware/security.js';
import { createUiRouter } from './http/middleware/ui.js';
import { buildOpenApiDocument } from './http/openapi.js';
import { createRouteKit, createRouteRegistry } from './http/route-kit.js';
import { registerAnalyticsRoutes } from './modules/analytics/analytics.routes.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { registerHealthRoutes } from './modules/health/health.routes.js';
import { registerLinkRoutes } from './modules/links/link.routes.js';
import { registerRedirectRoutes } from './modules/redirect/redirect.routes.js';

const API_PREFIX = '/api/v1';

const DOC_TAGS = [
  { name: 'Auth', description: 'Accounts and access tokens' },
  { name: 'Links', description: 'Create and manage short links' },
  { name: 'Analytics', description: 'Click statistics for your links' },
  { name: 'System', description: 'Health checks' },
];

/**
 * Assembles the Express application from an already-built container. Does not start listening.
 *
 * Express runs middleware in registration order, so the order below is deliberate: cross-cutting
 * concerns first, then system routes, the API, docs, the UI, and only then the catch-all
 * `/:code` redirect (which would otherwise swallow every single-segment path).
 *
 * @param {ReturnType<typeof import('./container.js').createContainer>} container
 * @returns {import('express').Express}
 */
export function createApp(container) {
  const { config, logger, redis, pool, metrics, tokens } = container;
  const { rateLimit: limits } = config;
  const app = express();

  app.disable('x-powered-by');
  app.set('etag', false); // JSON responses are not revalidated; skip hashing every body
  app.enable('case sensitive routing'); // short codes are case-sensitive
  // Hops of reverse proxy in front of the app: the client address is then taken from
  // X-Forwarded-For counting from the right, so a client cannot spoof it. 0 = no proxy.
  app.set('trust proxy', config.server.trustProxyHops);

  app.use(requestContext(logger));
  app.use((_req, res, next) => {
    // During shutdown, ask clients on keep-alive connections to reconnect (to another replica).
    if (app.locals.shuttingDown) res.set('connection', 'close');
    next();
  });
  app.use(securityMiddleware({ corsOrigins: config.server.corsOrigins }));
  app.use(httpMetrics(metrics));

  const registry = createRouteRegistry();
  const createRouter = createRouteKit({ registry, auth: createAuthMiddleware(tokens) });
  const limiter = createLimiterFactory({
    redis,
    enabled: limits.enabled,
    logger,
    validate: config.env !== 'test',
  });

  // Probes and metrics (not rate limited).
  const system = createRouter();
  registerHealthRoutes(system.route, { pool, redis });
  system.route({
    method: 'get',
    path: '/metrics',
    hidden: true, // scraped by Prometheus; the reverse proxy blocks it from the outside
    handler: async (_req, res) => {
      res.type(metrics.registry.contentType).send(await metrics.registry.metrics());
    },
  });
  app.use(system.router);

  // The JSON API.
  const api = createRouter(API_PREFIX, {
    defaultLimit: limiter({ name: 'api', perMinute: limits.apiPerMinute }),
  });
  registerAuthRoutes(api.route, {
    authService: container.authService,
    tokens,
    limit: limiter({ name: 'auth', perMinute: limits.authPerMinute }),
  });
  registerLinkRoutes(api.route, {
    links: container.linkService,
    resolver: container.resolver,
    baseUrl: config.server.baseUrl,
    createLimit: limiter({
      name: 'create-link',
      // Anonymous callers get a smaller budget than signed-in users.
      perMinute: (req) =>
        req.auth?.user ? limits.createUserPerMinute : limits.createAnonPerMinute,
    }),
  });
  registerAnalyticsRoutes(api.route, { analytics: container.analyticsService });
  app.use(API_PREFIX, api.router);

  // The redirect route is declared now so it appears in the docs, but mounted last (see below).
  const redirect = createRouter();
  registerRedirectRoutes(redirect.route, {
    resolver: container.resolver,
    tracker: container.tracker,
    metrics,
    countryHeader: config.clicks.countryHeader,
  });

  // OpenAPI document generated from the same declarations that drive validation.
  const spec = buildOpenApiDocument({
    info: {
      title: 'URL Shortener API',
      description:
        'Create short links, manage them, and read click analytics. ' +
        'Short links themselves are served at `GET /{code}`.',
      version: '1.0.0',
    },
    servers: [{ url: config.server.baseUrl }],
    tags: DOC_TAGS,
    registry,
  });
  app.get('/docs/json', (_req, res) => res.json(spec));
  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(spec, { customSiteTitle: 'URL Shortener API' }),
  );

  const ui = createUiRouter({ webDir: config.server.webDir, logger });
  if (ui) app.use(ui);

  app.use(redirect.router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
