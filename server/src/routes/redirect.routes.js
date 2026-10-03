import { ApiTag, HttpMethod, HttpStatus } from '../constants.js';
import { errorResponses } from '../schemas/error.schemas.js';
import { redirectParams } from '../schemas/link.schemas.js';

export function registerRedirectRoutes(route, { controller }) {
  route({
    method: HttpMethod.GET,
    path: '/:code',
    tags: [ApiTag.LINKS],
    summary: 'Redirect to the destination (HTTP 302)',
    description:
      'Public endpoint. Answers 404 for unknown codes and 410 for expired, disabled or deleted links.',
    request: { params: redirectParams },
    responses: {
      [HttpStatus.FOUND]: null,
      ...errorResponses(HttpStatus.NOT_FOUND, HttpStatus.GONE),
    },
    handler: controller.redirect,
  });
}
