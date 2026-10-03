import { createAnalyticsController } from './controllers/analytics.controller.js';
import { createAuthController } from './controllers/auth.controller.js';
import { createLinkController } from './controllers/link.controller.js';
import { createRedirectController } from './controllers/redirect.controller.js';
import { createSystemController } from './controllers/system.controller.js';
import { createPool } from './infra/database.js';
import { createMetrics, registerStreamBacklogGauge } from './infra/metrics.js';
import { createRedis } from './infra/redis.js';
import { createAnalyticsService } from './services/analytics.service.js';
import { createClickRepository } from './repositories/click.repository.js';
import { createClickTracker } from './services/click-tracker.service.js';
import { createRedisClickPublisher } from './queue/redis-click-publisher.js';
import { createAuthService } from './services/auth.service.js';
import { createScryptPasswordHasher } from './services/password-hasher.service.js';
import { createTokenService } from './services/token.service.js';
import { createUserRepository } from './repositories/user.repository.js';
import { createRedisLinkCache } from './cache/link.cache.js';
import { createLinkRepository } from './repositories/link.repository.js';
import { createLinkService } from './services/link.service.js';
import { createUrlPolicy } from './services/url-policy.service.js';
import { createLinkResolver } from './services/link-resolver.service.js';
import { createLogger } from './infra/logger.js';

// Builds every long-lived object once and gives each class the collaborators it needs. This is the
// only place that knows which concrete class is used where.
export function createDependencies(config, overrides = {}) {
  const logger = createLogger(config);
  const pool = createPool(config.db, logger);
  const redis = createRedis(config.redis.url, logger);
  const metrics = createMetrics();
  registerStreamBacklogGauge(metrics, redis, config.clicks.streamKey);

  const linkRepository = createLinkRepository(pool);
  const userRepository = createUserRepository(pool);
  const clickRepository = createClickRepository(pool);

  const linkCache = createRedisLinkCache({
    redis,
    logger,
    metrics,
    ttlSeconds: config.links.cacheTtlSeconds,
    negativeTtlSeconds: config.links.negativeCacheTtlSeconds,
  });
  const urlPolicy = createUrlPolicy({
    blockedDomains: config.links.blockedDomains,
    selfHostname: new URL(config.server.baseUrl).hostname,
  });

  const tokenService = createTokenService({
    secret: config.auth.jwtSecret,
    ttlSeconds: config.auth.jwtTtlSeconds,
  });
  const authService = createAuthService({
    users: userRepository,
    hasher: overrides.passwordHasher ?? createScryptPasswordHasher(),
  });

  const linkService = createLinkService({ links: linkRepository, cache: linkCache, urlPolicy });
  const resolver = createLinkResolver({ links: linkRepository, cache: linkCache, metrics });
  const analyticsService = createAnalyticsService({
    links: linkRepository,
    clicks: clickRepository,
  });
  const tracker = createClickTracker({
    publisher: createRedisClickPublisher(redis, {
      streamKey: config.clicks.streamKey,
      maxLength: config.clicks.streamMaxLen,
    }),
    visitorHashSecret: config.clicks.visitorHashSecret,
    logger,
    metrics,
  });

  const controllers = {
    auth: createAuthController({ authService, tokenService }),
    link: createLinkController({
      links: linkService,
      resolver,
      baseUrl: config.server.baseUrl,
    }),
    analytics: createAnalyticsController({ analytics: analyticsService }),
    redirect: createRedirectController({
      resolver,
      tracker,
      metrics,
      countryHeader: config.clicks.countryHeader,
    }),
    system: createSystemController({ pool, redis, metrics }),
  };

  return {
    config,
    logger,
    pool,
    redis,
    metrics,
    tokenService,
    authService,
    linkService,
    resolver,
    analyticsService,
    tracker,
    controllers,
    // Call after the HTTP server has stopped accepting requests.
    async close() {
      await pool.end();
      await redis.quit().catch(() => redis.disconnect());
    },
  };
}
