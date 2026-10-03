import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { createAuthMiddleware } from './middleware/auth.middleware.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.middleware.js';
import { httpMetrics } from './middleware/metrics.middleware.js';
import { createRateLimiterFactory } from './middleware/rate-limit.middleware.js';
import { requestContext } from './middleware/request-context.middleware.js';
import { securityMiddleware } from './middleware/security.middleware.js';
import { createUiRouter } from './middleware/ui.middleware.js';
import { buildOpenApiDocument } from './routes/openapi.js';
import { createRouteRegistry, createRouterFactory } from './routes/router-factory.js';
import { registerAnalyticsRoutes } from './routes/analytics.routes.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerSystemRoutes } from './routes/system.routes.js';
import { registerLinkRoutes } from './routes/link.routes.js';
import { registerRedirectRoutes } from './routes/redirect.routes.js';
import { ApiTag, Environment, HttpHeader, RateLimiterName, RoutePath } from './constants.js';

const API_TITLE = 'URL Shortener API';

const OPENAPI_TAGS = [
  { name: ApiTag.AUTH, description: 'Accounts and access tokens' },
  { name: ApiTag.LINKS, description: 'Create and manage short links' },
  { name: ApiTag.ANALYTICS, description: 'Click statistics for your links' },
  { name: ApiTag.SYSTEM, description: 'Health checks' },
];

// Builds the Express app; it does not start listening. Express runs middleware in the order it is
// registered, so the order below is deliberate: cross-cutting middleware, system routes, the JSON
// API, the docs and UI, and last the catch-all `/:code` redirect, which would otherwise swallow
// every single-segment path.
export function createApp(dependencies) {
  const { config, logger, redis, metrics, tokenService, controllers } = dependencies;
  const rateLimits = config.rateLimit;
  const app = express();

  app.disable('x-powered-by');
  app.set('etag', false); // JSON responses are not revalidated, so do not hash every body
  app.enable('case sensitive routing'); // short codes are case-sensitive
  app.set('trust proxy', config.server.trustProxyHops);

  app.use(requestContext(logger));
  app.use((_req, res, next) => {
    // While shutting down, ask clients on keep-alive connections to reconnect (to another replica).
    if (app.locals.shuttingDown) res.set(HttpHeader.CONNECTION, 'close');
    next();
  });
  app.use(securityMiddleware({ corsOrigins: config.server.corsOrigins }));
  app.use(httpMetrics(metrics));

  const routeRegistry = createRouteRegistry();
  const createRouter = createRouterFactory({
    routeRegistry,
    authMiddleware: createAuthMiddleware(tokenService),
  });
  const createRateLimiter = createRateLimiterFactory({
    redis,
    enabled: rateLimits.enabled,
    logger,
    validate: config.env !== Environment.TEST,
  });

  // Health probes and metrics are not rate limited.
  const systemRouter = createRouter();
  registerSystemRoutes(systemRouter.route, { controller: controllers.system });
  app.use(systemRouter.router);

  const apiRouter = createRouter(RoutePath.API_PREFIX, {
    defaultRateLimiter: createRateLimiter({
      name: RateLimiterName.API,
      requestsPerMinute: rateLimits.apiPerMinute,
    }),
  });
  registerAuthRoutes(apiRouter.route, {
    controller: controllers.auth,
    rateLimiter: createRateLimiter({
      name: RateLimiterName.AUTH,
      requestsPerMinute: rateLimits.authPerMinute,
    }),
  });
  registerLinkRoutes(apiRouter.route, {
    controller: controllers.link,
    linkCreationRateLimiter: createRateLimiter({
      name: RateLimiterName.CREATE_LINK,
      // Anonymous callers get a smaller budget than signed-in users.
      requestsPerMinute: (req) =>
        req.auth?.user ? rateLimits.createUserPerMinute : rateLimits.createAnonPerMinute,
    }),
  });
  registerAnalyticsRoutes(apiRouter.route, { controller: controllers.analytics });
  app.use(RoutePath.API_PREFIX, apiRouter.router);

  // Declared now so it appears in the docs, but mounted last (see above).
  const redirectRouter = createRouter();
  registerRedirectRoutes(redirectRouter.route, { controller: controllers.redirect });

  const openApiDocument = buildOpenApiDocument({
    info: {
      title: API_TITLE,
      description:
        'Create short links, manage them, and read click analytics. ' +
        'Short links themselves are served at `GET /{code}`.',
      version: '1.0.0',
    },
    servers: [{ url: config.server.baseUrl }],
    tags: OPENAPI_TAGS,
    routeRegistry,
  });
  app.get(RoutePath.DOCS_JSON, (_req, res) => res.json(openApiDocument));
  app.use(
    RoutePath.DOCS,
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, { customSiteTitle: API_TITLE }),
  );

  const uiRouter = createUiRouter({ webDir: config.server.webDir, logger });
  if (uiRouter) app.use(uiRouter);

  app.use(redirectRouter.router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
