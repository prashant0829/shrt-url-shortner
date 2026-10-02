import { createPool } from './infra/database.js';
import { createMetrics, registerStreamBacklogGauge } from './infra/metrics.js';
import { createRedis } from './infra/redis.js';
import { AnalyticsService } from './modules/analytics/analytics.service.js';
import { ClickRepository } from './modules/analytics/click.repository.js';
import { ClickTracker } from './modules/analytics/click-tracker.js';
import { RedisClickPublisher } from './modules/analytics/redis-click-publisher.js';
import { AuthService } from './modules/auth/auth.service.js';
import { ScryptPasswordHasher } from './modules/auth/password-hasher.js';
import { TokenService } from './modules/auth/token-service.js';
import { UserRepository } from './modules/auth/user.repository.js';
import { RedisLinkCache } from './modules/links/link.cache.js';
import { LinkRepository } from './modules/links/link.repository.js';
import { LinkService } from './modules/links/link.service.js';
import { UrlPolicy } from './modules/links/url-policy.js';
import { LinkResolver } from './modules/redirect/link-resolver.js';
import { createLogger } from './shared/logger.js';

/**
 * Composition root: the only place that knows which concrete class implements which port.
 * Everything else receives its collaborators through constructors, which keeps units testable.
 */
export function createContainer(config, overrides = {}) {
  const logger = createLogger(config);
  const pool = createPool(config.db, logger);
  const redis = createRedis(config.redis.url, logger);
  const metrics = createMetrics();
  registerStreamBacklogGauge(metrics, redis, config.clicks.streamKey);

  const linkStore = new LinkRepository(pool);
  const userStore = new UserRepository(pool);
  const clickRepository = new ClickRepository(pool);

  const cache = new RedisLinkCache({
    redis,
    logger,
    metrics,
    ttlSeconds: config.links.cacheTtlSeconds,
    negativeTtlSeconds: config.links.negativeCacheTtlSeconds,
  });
  const urlPolicy = new UrlPolicy({
    blockedDomains: config.links.blockedDomains,
    selfHostname: new URL(config.server.baseUrl).hostname,
  });

  const tokens = new TokenService({
    secret: config.auth.jwtSecret,
    ttlSeconds: config.auth.jwtTtlSeconds,
  });
  const authService = new AuthService({
    users: userStore,
    hasher: overrides.passwordHasher ?? new ScryptPasswordHasher(),
  });

  const linkService = new LinkService({ links: linkStore, cache, urlPolicy });
  const resolver = new LinkResolver({ links: linkStore, cache, metrics });
  const analyticsService = new AnalyticsService({ links: linkStore, clicks: clickRepository });
  const tracker = new ClickTracker({
    publisher: new RedisClickPublisher(redis, {
      streamKey: config.clicks.streamKey,
      maxLength: config.clicks.streamMaxLen,
    }),
    visitorHashSecret: config.clicks.visitorHashSecret,
    logger,
    metrics,
  });

  return {
    config,
    logger,
    pool,
    redis,
    metrics,
    tokens,
    authService,
    linkService,
    resolver,
    analyticsService,
    tracker,
    /** Releases connections; call after the HTTP server has stopped accepting requests. */
    async close() {
      await pool.end();
      await redis.quit().catch(() => redis.disconnect());
    },
  };
}
