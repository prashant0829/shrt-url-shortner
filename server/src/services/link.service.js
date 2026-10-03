import { ErrorCode, MAX_CODE_GENERATION_ATTEMPTS } from '../constants.js';
import {
  badRequestError,
  conflictError,
  notFoundError,
  serviceUnavailableError,
} from '../errors.js';
import { toRedirectTarget } from '../cache/link.cache.js';
import { decodeCursor, encodeCursor } from '../utils/pagination.js';
import {
  generateShortCode as defaultGenerateShortCode,
  isReservedShortCode,
} from '../utils/short-code.js';

// Someone else's link (or a deleted one) is reported as missing, so its existence is not disclosed.
export function assertLinkOwnedBy(link, userId) {
  if (!link || link.deletedAt !== null || link.userId !== userId) {
    throw notFoundError(ErrorCode.LINK_NOT_FOUND, 'Link not found');
  }
  return link;
}

export function createLinkService({
  links,
  cache,
  urlPolicy,
  generateShortCode = defaultGenerateShortCode,
  now = () => new Date(),
}) {
  // `null` (clear the expiry) and `undefined` (leave it untouched) pass through unchanged.
  function assertFutureExpiry(expiresAt) {
    if (expiresAt && expiresAt.getTime() <= now().getTime()) {
      throw badRequestError(ErrorCode.INVALID_EXPIRY, 'expiresAt must be in the future');
    }
    return expiresAt;
  }

  async function insertWithAlias(draft, alias) {
    if (isReservedShortCode(alias)) {
      throw conflictError(ErrorCode.ALIAS_RESERVED, 'This alias is reserved');
    }
    const link = await links.insert({ ...draft, code: alias });
    if (!link) throw conflictError(ErrorCode.ALIAS_TAKEN, 'This alias is already in use');
    return link;
  }

  // A random code rarely collides with an existing one (about 1 in 3.5 million at a million links),
  // so a few retries make failure negligible.
  async function insertWithGeneratedCode(draft) {
    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt++) {
      const code = generateShortCode();
      if (isReservedShortCode(code)) continue;

      const link = await links.insert({ ...draft, code });
      if (link) return link;
    }
    throw serviceUnavailableError(
      ErrorCode.CODE_GENERATION_FAILED,
      'Could not allocate a short code',
    );
  }

  // `userId` is null for anonymous links, which cannot be managed afterwards.
  async function create({ url, customAlias, expiresAt, userId }) {
    const draft = {
      originalUrl: urlPolicy.normalize(url),
      userId,
      expiresAt: assertFutureExpiry(expiresAt) ?? null,
    };

    const link = customAlias
      ? await insertWithAlias(draft, customAlias)
      : await insertWithGeneratedCode(draft);

    // Warm the cache. This also replaces a "does not exist" entry left by an earlier lookup.
    await cache.set(link.code, toRedirectTarget(link));
    return link;
  }

  async function getOwned(code, userId) {
    return assertLinkOwnedBy(await links.findByCode(code), userId);
  }

  async function list(userId, { limit, cursor, search }) {
    const beforeId = cursor ? decodeCursor(cursor) : undefined;

    // Fetch one extra row to learn whether another page exists.
    const rows = await links.listByUser({ userId, limit: limit + 1, beforeId, search });

    const items = rows.slice(0, limit);
    const lastItem = items.at(-1);
    const hasNextPage = rows.length > limit;
    return { items, nextCursor: hasNextPage && lastItem ? encodeCursor(lastItem.id) : null };
  }

  async function update(code, userId, { url, isActive, expiresAt }) {
    await getOwned(code, userId);

    const patch = { isActive };
    if (url !== undefined) patch.originalUrl = urlPolicy.normalize(url);
    if (expiresAt !== undefined) patch.expiresAt = assertFutureExpiry(expiresAt);

    const updated = await links.update(code, patch);
    if (!updated) throw notFoundError(ErrorCode.LINK_NOT_FOUND, 'Link not found');

    await cache.delete(code);
    return updated;
  }

  async function deleteLink(code, userId) {
    await getOwned(code, userId);
    await links.softDelete(code);
    await cache.delete(code);
  }

  return { create, getOwned, list, update, delete: deleteLink };
}
