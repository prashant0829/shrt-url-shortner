import { randomUUID } from 'node:crypto';
import pinoHttp from 'pino-http';
import { HttpHeader, HttpStatus, RoutePath } from '../constants.js';

// A request id from a proxy is trusted only if it is short and boring: it ends up in logs and headers.
const REQUEST_ID_PATTERN = /^[\w.-]{1,128}$/;

const isProbeOrMetricsScrape = (req) =>
  req.url === RoutePath.METRICS || req.url?.startsWith(RoutePath.HEALTH_PREFIX);

// Logs every request and gives it an id (the proxy's, if sane), echoed in the response header and
// in error bodies so one request can be followed across nginx, the API and the logs.
export function requestContext(logger) {
  return pinoHttp({
    logger,
    genReqId(req, res) {
      const incomingId = req.headers[HttpHeader.REQUEST_ID];
      const id =
        typeof incomingId === 'string' && REQUEST_ID_PATTERN.test(incomingId)
          ? incomingId
          : randomUUID();
      res.setHeader(HttpHeader.REQUEST_ID, id);
      return id;
    },
    autoLogging: { ignore: isProbeOrMetricsScrape },
    customLogLevel: (_req, res, err) =>
      err || res.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR ? 'error' : 'info',
    // Headers can carry credentials, so log just enough to follow a request.
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  });
}
