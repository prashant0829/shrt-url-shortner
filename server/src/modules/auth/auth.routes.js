import { currentUser } from '../../http/middleware/auth.js';
import { errorResponse } from '../../shared/http-schemas.js';
import { authResponse, loginBody, meResponse, registerBody } from './auth.schemas.js';

const toUserView = (user) => ({
  id: user.id,
  email: user.email,
  createdAt: user.createdAt.toISOString(),
});

/**
 * @param {(definition: import('../../http/route-kit.js').RouteDefinition) => void} route
 * @param {object} deps
 * @param {import('./auth.service.js').AuthService} deps.authService
 * @param {import('./token-service.js').TokenService} deps.tokens
 * @param {import('express').RequestHandler} deps.limit Tight per-IP budget: makes brute-forcing credentials impractical.
 */
export function registerAuthRoutes(route, { authService, tokens, limit }) {
  const openSession = async (user) => ({
    ...(await tokens.issue(user.id)),
    user: toUserView(user),
  });

  route({
    method: 'post',
    path: '/auth/register',
    limit,
    tags: ['Auth'],
    summary: 'Create an account',
    request: { body: registerBody },
    responses: { 201: authResponse, 400: errorResponse, 409: errorResponse, 429: errorResponse },
    handler: async (req, res) => {
      const { email, password } = req.input.body;
      const user = await authService.register(email, password);
      res.status(201).json(await openSession(user));
    },
  });

  route({
    method: 'post',
    path: '/auth/login',
    limit,
    tags: ['Auth'],
    summary: 'Exchange credentials for an access token',
    request: { body: loginBody },
    responses: { 200: authResponse, 400: errorResponse, 401: errorResponse, 429: errorResponse },
    handler: async (req, res) => {
      const { email, password } = req.input.body;
      res.json(await openSession(await authService.login(email, password)));
    },
  });

  route({
    method: 'get',
    path: '/auth/me',
    security: 'required',
    tags: ['Auth'],
    summary: 'The signed-in account',
    responses: { 200: meResponse, 401: errorResponse },
    handler: async (req, res) => {
      const user = await authService.getUser(currentUser(req).id);
      res.json({ user: toUserView(user) });
    },
  });
}
