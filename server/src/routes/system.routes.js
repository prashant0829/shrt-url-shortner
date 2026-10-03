import { ApiTag, HttpMethod, HttpStatus, RoutePath } from '../constants.js';
import { liveResponse, readyResponse } from '../schemas/system.schemas.js';

export function registerSystemRoutes(route, { controller }) {
  route({
    method: HttpMethod.GET,
    path: RoutePath.HEALTH_LIVE,
    tags: [ApiTag.SYSTEM],
    summary: 'Liveness: the process is running',
    responses: { [HttpStatus.OK]: liveResponse },
    handler: controller.live,
  });

  route({
    method: HttpMethod.GET,
    path: RoutePath.HEALTH_READY,
    tags: [ApiTag.SYSTEM],
    summary: 'Readiness: Postgres and Redis are reachable',
    responses: { [HttpStatus.OK]: readyResponse, [HttpStatus.SERVICE_UNAVAILABLE]: readyResponse },
    handler: controller.ready,
  });

  route({
    method: HttpMethod.GET,
    path: RoutePath.METRICS,
    hiddenFromDocs: true, // Prometheus scrapes it; the reverse proxy blocks it from outside
    handler: controller.metrics,
  });
}
