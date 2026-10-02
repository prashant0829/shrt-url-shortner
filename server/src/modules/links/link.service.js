import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from '../../shared/errors.js';
import { toLinkTarget } from './link.mapper.js';
import { generateCode, isReservedCode } from './link-code.js';
import { decodeCursor, encodeCursor } from './pagination.js';

/**
 * A random 7-character code collides with an existing one with probability (links / 62^7):
 * ~3e-7 at a million links, ~3e-4 at a billion. Five independent tries make failure negligible
 * (~2e-18 even at a billion); raise the code length long before the table nears 10^10 rows.
 */
const MAX_CODE_ATTEMPTS = 5;

/**
 * @typedef {object} CreateLinkInput
 * @property {string} url
 * @property {string} [customAlias]
 * @property {Date} [expiresAt]
 * @property {string | null} userId `null` for anonymous links, which cannot be managed afterwards.
 */

/**
 * @typedef {object} UpdateLinkInput
 * @property {string} [url]
 * @property {boolean} [isActive]
 * @property {Date | null} [expiresAt] `null` removes the expiry; `undefined` leaves it untouched.
 */

/**
 * @typedef {object} ListLinksInput
 * @property {number} limit
 * @property {string} [cursor]
 * @property {string} [search]
 */

/**
 * @typedef {object} LinkPage
 * @property {import('./link.repository.js').LinkRecord[]} items
 * @property {string | null} nextCursor
 */

/**
 * @typedef {object} LinkServiceDeps
 * @property {import('./link.repository.js').LinkStore} links
 * @property {import('./link.cache.js').LinkCache} cache
 * @property {import('./url-policy.js').UrlPolicy} urlPolicy
 * @property {() => string} [generateCode]
 * @property {() => Date} [now]
 */

export class LinkService {
  #links;
  #cache;
  #urlPolicy;
  #generateCode;
  #now;

  /** @param {LinkServiceDeps} deps */
  constructor(deps) {
    this.#links = deps.links;
    this.#cache = deps.cache;
    this.#urlPolicy = deps.urlPolicy;
    this.#generateCode = deps.generateCode ?? generateCode;
    this.#now = deps.now ?? (() => new Date());
  }

  async create(input) {
    const originalUrl = this.#urlPolicy.normalize(input.url);
    const expiresAt = this.#assertFutureExpiry(input.expiresAt) ?? null;
    const draft = { originalUrl, userId: input.userId, expiresAt };

    let link = null;

    if (input.customAlias) {
      if (isReservedCode(input.customAlias)) {
        throw new ConflictError('ALIAS_RESERVED', 'This alias is reserved');
      }
      link = await this.#links.insert({ ...draft, code: input.customAlias });
      if (!link) throw new ConflictError('ALIAS_TAKEN', 'This alias is already in use');
    } else {
      for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS && !link; attempt++) {
        const code = this.#generateCode();
        if (isReservedCode(code)) continue;
        link = await this.#links.insert({ ...draft, code });
      }
      if (!link) {
        throw new ServiceUnavailableError(
          'CODE_GENERATION_FAILED',
          'Could not allocate a short code',
        );
      }
    }

    // Warm the cache; this also overwrites any negative entry left by an earlier lookup of the code.
    await this.#cache.set(link.code, toLinkTarget(link));
    return link;
  }

  async getOwned(code, userId) {
    const link = await this.#links.findByCode(code);
    // Someone else's link is reported as missing so its existence is not disclosed.
    if (!link || link.deletedAt !== null || link.userId !== userId) {
      throw new NotFoundError('LINK_NOT_FOUND', 'Link not found');
    }
    return link;
  }

  async list(userId, input) {
    const beforeId = input.cursor ? decodeCursor(input.cursor) : undefined;
    // Fetch one extra row to learn whether another page exists.
    const rows = await this.#links.listByUser({
      userId,
      limit: input.limit + 1,
      beforeId,
      search: input.search,
    });

    const items = rows.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: rows.length > input.limit && last ? encodeCursor(last.id) : null,
    };
  }

  async update(code, userId, input) {
    await this.getOwned(code, userId);

    const patch = { isActive: input.isActive };
    if (input.url !== undefined) patch.originalUrl = this.#urlPolicy.normalize(input.url);
    if (input.expiresAt !== undefined) patch.expiresAt = this.#assertFutureExpiry(input.expiresAt);

    const updated = await this.#links.update(code, patch);
    if (!updated) throw new NotFoundError('LINK_NOT_FOUND', 'Link not found');

    await this.#cache.delete(code);
    return updated;
  }

  async delete(code, userId) {
    await this.getOwned(code, userId);
    await this.#links.softDelete(code);
    await this.#cache.delete(code);
  }

  /** `null` (clearing the expiry) and `undefined` (untouched) pass through unchanged. */
  #assertFutureExpiry(expiresAt) {
    if (expiresAt && expiresAt.getTime() <= this.#now().getTime()) {
      throw new BadRequestError('INVALID_EXPIRY', 'expiresAt must be in the future');
    }
    return expiresAt;
  }
}
