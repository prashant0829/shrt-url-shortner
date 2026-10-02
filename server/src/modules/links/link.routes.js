import { binaryResponse } from '../../http/openapi.js';
import { currentUser } from '../../http/middleware/auth.js';
import { GoneError, NotFoundError } from '../../shared/errors.js';
import { errorResponse } from '../../shared/http-schemas.js';
import { toLinkView } from './link.mapper.js';
import {
  codeParams,
  createLinkBody,
  linkListView,
  linkView,
  listLinksQuery,
  qrQuery,
  updateLinkBody,
} from './link.schemas.js';
import { renderQr } from './qr-code.js';

/**
 * @param {(definition: import('../../http/route-kit.js').RouteDefinition) => void} route
 * @param {object} deps
 * @param {import('./link.service.js').LinkService} deps.links
 * @param {import('../redirect/link-resolver.js').LinkResolver} deps.resolver
 * @param {string} deps.baseUrl
 * @param {import('express').RequestHandler} deps.createLimit Budget for link creation (larger for signed-in users).
 */
export function registerLinkRoutes(route, { links, resolver, baseUrl, createLimit }) {
  const view = (link) => toLinkView(link, baseUrl);

  route({
    method: 'post',
    path: '/links',
    security: 'optional',
    limit: createLimit,
    tags: ['Links'],
    summary: 'Create a short link',
    description:
      'Works anonymously, or with a bearer token to own the link, list it and read its analytics.',
    request: { body: createLinkBody },
    responses: {
      201: linkView,
      400: errorResponse,
      401: errorResponse,
      409: errorResponse,
      429: errorResponse,
    },
    handler: async (req, res) => {
      const { url, customAlias, expiresAt } = req.input.body;
      const link = await links.create({
        url,
        customAlias,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        userId: req.auth.user?.id ?? null,
      });
      res.status(201).json(view(link));
    },
  });

  route({
    method: 'get',
    path: '/links',
    security: 'required',
    tags: ['Links'],
    summary: 'List your links, newest first',
    request: { query: listLinksQuery },
    responses: { 200: linkListView, 400: errorResponse, 401: errorResponse },
    handler: async (req, res) => {
      const { limit, cursor, q } = req.input.query;
      const page = await links.list(currentUser(req).id, { limit, cursor, search: q });
      res.json({ items: page.items.map(view), nextCursor: page.nextCursor });
    },
  });

  route({
    method: 'get',
    path: '/links/:code',
    security: 'required',
    tags: ['Links'],
    summary: 'Get one of your links',
    request: { params: codeParams },
    responses: { 200: linkView, 401: errorResponse, 404: errorResponse },
    handler: async (req, res) => {
      res.json(view(await links.getOwned(req.input.params.code, currentUser(req).id)));
    },
  });

  route({
    method: 'patch',
    path: '/links/:code',
    security: 'required',
    tags: ['Links'],
    summary: 'Change destination, expiry or enabled state',
    request: { params: codeParams, body: updateLinkBody },
    responses: { 200: linkView, 400: errorResponse, 401: errorResponse, 404: errorResponse },
    handler: async (req, res) => {
      const { url, isActive, expiresAt } = req.input.body;
      const updated = await links.update(req.input.params.code, currentUser(req).id, {
        url,
        isActive,
        // `null` clears the expiry; `undefined` leaves it untouched.
        expiresAt: expiresAt === undefined || expiresAt === null ? expiresAt : new Date(expiresAt),
      });
      res.json(view(updated));
    },
  });

  route({
    method: 'delete',
    path: '/links/:code',
    security: 'required',
    tags: ['Links'],
    summary: 'Delete a link (its code stays reserved)',
    request: { params: codeParams },
    responses: { 204: null, 401: errorResponse, 404: errorResponse },
    handler: async (req, res) => {
      await links.delete(req.input.params.code, currentUser(req).id);
      res.status(204).end();
    },
  });

  route({
    method: 'get',
    path: '/links/:code/qr',
    tags: ['Links'],
    summary: 'QR code that opens the short link',
    request: { params: codeParams, query: qrQuery },
    responses: {
      200: binaryResponse('PNG or SVG image', 'image/png', 'image/svg+xml'),
      400: errorResponse,
      404: errorResponse,
      410: errorResponse,
    },
    handler: async (req, res) => {
      const { code } = req.input.params;
      const resolution = await resolver.resolve(code);
      if (resolution.status === 'not_found')
        throw new NotFoundError('LINK_NOT_FOUND', 'Link not found');
      if (resolution.status === 'gone') throw new GoneError('LINK_GONE');

      const qr = await renderQr(`${baseUrl}/${code}`, req.input.query);
      res.set('cache-control', 'public, max-age=3600').type(qr.contentType).send(qr.body);
    },
  });
}
