import { ApiTag, ContentType, HttpMethod, HttpStatus, RouteSecurity } from '../constants.js';
import { errorResponses } from '../schemas/error.schemas.js';
import {
  codeParams,
  createLinkBody,
  linkListView,
  linkView,
  listLinksQuery,
  qrQuery,
  updateLinkBody,
} from '../schemas/link.schemas.js';
import { binaryResponse } from './openapi.js';

// `linkCreationRateLimiter` gives signed-in users a larger budget than anonymous callers.
export function registerLinkRoutes(route, { controller, linkCreationRateLimiter }) {
  route({
    method: HttpMethod.POST,
    path: '/links',
    security: RouteSecurity.OPTIONAL,
    rateLimiter: linkCreationRateLimiter,
    tags: [ApiTag.LINKS],
    summary: 'Create a short link',
    description:
      'Works anonymously, or with a bearer token to own the link, list it and read its analytics.',
    request: { body: createLinkBody },
    responses: {
      [HttpStatus.CREATED]: linkView,
      ...errorResponses(
        HttpStatus.BAD_REQUEST,
        HttpStatus.UNAUTHORIZED,
        HttpStatus.CONFLICT,
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    },
    handler: controller.create,
  });

  route({
    method: HttpMethod.GET,
    path: '/links',
    security: RouteSecurity.REQUIRED,
    tags: [ApiTag.LINKS],
    summary: 'List your links, newest first',
    request: { query: listLinksQuery },
    responses: {
      [HttpStatus.OK]: linkListView,
      ...errorResponses(HttpStatus.BAD_REQUEST, HttpStatus.UNAUTHORIZED),
    },
    handler: controller.list,
  });

  route({
    method: HttpMethod.GET,
    path: '/links/:code',
    security: RouteSecurity.REQUIRED,
    tags: [ApiTag.LINKS],
    summary: 'Get one of your links',
    request: { params: codeParams },
    responses: {
      [HttpStatus.OK]: linkView,
      ...errorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.NOT_FOUND),
    },
    handler: controller.get,
  });

  route({
    method: HttpMethod.PATCH,
    path: '/links/:code',
    security: RouteSecurity.REQUIRED,
    tags: [ApiTag.LINKS],
    summary: 'Change destination, expiry or enabled state',
    request: { params: codeParams, body: updateLinkBody },
    responses: {
      [HttpStatus.OK]: linkView,
      ...errorResponses(HttpStatus.BAD_REQUEST, HttpStatus.UNAUTHORIZED, HttpStatus.NOT_FOUND),
    },
    handler: controller.update,
  });

  route({
    method: HttpMethod.DELETE,
    path: '/links/:code',
    security: RouteSecurity.REQUIRED,
    tags: [ApiTag.LINKS],
    summary: 'Delete a link (its code stays reserved)',
    request: { params: codeParams },
    responses: {
      [HttpStatus.NO_CONTENT]: null,
      ...errorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.NOT_FOUND),
    },
    handler: controller.remove,
  });

  route({
    method: HttpMethod.GET,
    path: '/links/:code/qr',
    tags: [ApiTag.LINKS],
    summary: 'QR code that opens the short link',
    request: { params: codeParams, query: qrQuery },
    responses: {
      [HttpStatus.OK]: binaryResponse('PNG or SVG image', ContentType.PNG, ContentType.SVG),
      ...errorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.GONE),
    },
    handler: controller.qr,
  });
}
