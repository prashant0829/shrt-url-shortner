import cors from 'cors';
import helmet from 'helmet';

/**
 * Security headers and CORS.
 * @param {{corsOrigins: string[]}} options
 */
export function securityMiddleware({ corsOrigins }) {
  return [
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        // TLS is terminated by the proxy in front of the app, which is responsible for HTTPS
        // upgrades; the directive would only break plain-HTTP local development.
        directives: { 'upgrade-insecure-requests': null },
      },
    }),
    // The bundled UI is same-origin, so cross-origin access is off unless explicitly allowed.
    cors({ origin: corsOrigins.length > 0 ? corsOrigins : false }),
  ];
}
