import { CacheControl, ErrorCode, HttpHeader, HttpStatus, RedirectOutcome } from '../constants.js';
import { goneError, notFoundError } from '../errors.js';
import { currentUser } from '../middleware/auth.middleware.js';
import { toDate } from '../utils/dates.js';
import { renderQr } from '../utils/qr-code.js';

const toLinkView = (link, baseUrl) => ({
  code: link.code,
  shortUrl: `${baseUrl}/${link.code}`,
  originalUrl: link.originalUrl,
  isActive: link.isActive,
  expiresAt: link.expiresAt?.toISOString() ?? null,
  clickCount: link.clickCount,
  createdAt: link.createdAt.toISOString(),
  updatedAt: link.updatedAt.toISOString(),
});

export function createLinkController({ links, resolver, baseUrl }) {
  const view = (link) => toLinkView(link, baseUrl);

  async function create(req, res) {
    const { url, customAlias, expiresAt } = req.input.body;
    const link = await links.create({
      url,
      customAlias,
      expiresAt: toDate(expiresAt),
      userId: req.auth.user?.id ?? null,
    });
    res.status(HttpStatus.CREATED).json(view(link));
  }

  async function list(req, res) {
    const { limit, cursor, q } = req.input.query;
    const page = await links.list(currentUser(req).id, { limit, cursor, search: q });
    res.json({ items: page.items.map(view), nextCursor: page.nextCursor });
  }

  async function get(req, res) {
    res.json(view(await links.getOwned(req.input.params.code, currentUser(req).id)));
  }

  async function update(req, res) {
    const { url, isActive, expiresAt } = req.input.body;
    const updated = await links.update(req.input.params.code, currentUser(req).id, {
      url,
      isActive,
      expiresAt: toDate(expiresAt),
    });
    res.json(view(updated));
  }

  async function remove(req, res) {
    await links.delete(req.input.params.code, currentUser(req).id);
    res.status(HttpStatus.NO_CONTENT).end();
  }

  async function qr(req, res) {
    const { code } = req.input.params;
    const { outcome } = await resolver.resolve(code);
    if (outcome === RedirectOutcome.NOT_FOUND) {
      throw notFoundError(ErrorCode.LINK_NOT_FOUND, 'Link not found');
    }
    if (outcome === RedirectOutcome.GONE) throw goneError(ErrorCode.LINK_GONE);

    const image = await renderQr(`${baseUrl}/${code}`, req.input.query);
    res
      .set(HttpHeader.CACHE_CONTROL, CacheControl.PUBLIC_ONE_HOUR)
      .type(image.contentType)
      .send(image.body);
  }

  return { create, list, get, update, remove, qr };
}
