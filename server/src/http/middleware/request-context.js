import { randomUUID } from 'node:crypto';
import pinoHttp from 'pino-http';

// Accept a request id from a proxy only if it is short and boring (it ends up in logs and headers).
const REQUEST_ID_PATTERN = /^[\w.-]{1,128}$/;

/**
 * Logs every request and gives it an id: reused from the proxy's `X-Request-Id` when it looks
 * sane, generated otherwise. The id is echoed in the response header and in error bodies, so one
 * request can be followed across nginx, the API and the logs.
 *
 * @param {import('pino').Logger} logger
 */
export function requestContext(logger) {
  return pinoHttp({
    logger,
    genReqId(req, res) {
      const incoming = req.headers['x-request-id'];
      const id =
        typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    // Probes and metric scrapes hit these constantly; keep them out of the access log.
    autoLogging: { ignore: (req) => req.url === '/metrics' || req.url?.startsWith('/health/') },
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : 'info'),
    // Log just enough to follow a request. Headers (which carry credentials) are never logged.
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  });
}
