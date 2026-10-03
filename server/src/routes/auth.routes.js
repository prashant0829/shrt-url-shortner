import { ApiTag, HttpMethod, HttpStatus, RouteSecurity } from '../constants.js';
import { authResponse, loginBody, meResponse, registerBody } from '../schemas/auth.schemas.js';
import { errorResponses } from '../schemas/error.schemas.js';

// `rateLimiter` is a tight per-IP budget, which makes brute-forcing credentials impractical.
export function registerAuthRoutes(route, { controller, rateLimiter }) {
  route({
    method: HttpMethod.POST,
    path: '/auth/register',
    rateLimiter,
    tags: [ApiTag.AUTH],
    summary: 'Create an account',
    request: { body: registerBody },
    responses: {
      [HttpStatus.CREATED]: authResponse,
      ...errorResponses(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT, HttpStatus.TOO_MANY_REQUESTS),
    },
    handler: controller.register,
  });

  route({
    method: HttpMethod.POST,
    path: '/auth/login',
    rateLimiter,
    tags: [ApiTag.AUTH],
    summary: 'Exchange credentials for an access token',
    request: { body: loginBody },
    responses: {
      [HttpStatus.OK]: authResponse,
      ...errorResponses(
        HttpStatus.BAD_REQUEST,
        HttpStatus.UNAUTHORIZED,
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    },
    handler: controller.login,
  });

  route({
    method: HttpMethod.GET,
    path: '/auth/me',
    security: RouteSecurity.REQUIRED,
    tags: [ApiTag.AUTH],
    summary: 'The signed-in account',
    responses: { [HttpStatus.OK]: meResponse, ...errorResponses(HttpStatus.UNAUTHORIZED) },
    handler: controller.me,
  });
}
