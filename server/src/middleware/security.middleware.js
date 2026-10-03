import cors from 'cors';
import helmet from 'helmet';

export function securityMiddleware({ corsOrigins }) {
  return [
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        // The proxy in front terminates TLS and handles HTTPS upgrades; this directive would only
        // break plain-HTTP local development.
        directives: { 'upgrade-insecure-requests': null },
      },
    }),
    // The bundled UI is same-origin, so cross-origin access stays off unless origins are listed.
    cors({ origin: corsOrigins.length > 0 ? corsOrigins : false }),
  ];
}
