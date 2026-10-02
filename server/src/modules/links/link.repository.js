/**
 * @typedef {object} LinkRecord
 * @property {number} id
 * @property {string} code
 * @property {string} originalUrl
 * @property {string | null} userId
 * @property {boolean} isActive
 * @property {Date | null} expiresAt
 * @property {number} clickCount
 * @property {Date} createdAt
 * @property {Date} updatedAt
 * @property {Date | null} deletedAt
 */

/**
 * @typedef {object} NewLink
 * @property {string} code
 * @property {string} originalUrl
 * @property {string | null} userId
 * @property {Date | null} expiresAt
 */

/**
 * @typedef {object} LinkPatch
 * @property {string} [originalUrl]
 * @property {boolean} [isActive]
 * @property {Date | null} [expiresAt]
 */

/**
 * @typedef {object} ListLinksParams
 * @property {string} userId
 * @property {number} limit
 * @property {number} [beforeId] Only links with a lower id (the keyset cursor).
 * @property {string} [search]
 */

/**
 * Persistence port used by the services; lets unit tests swap in an in-memory fake.
 * @typedef {object} LinkStore
 * @property {(link: NewLink) => Promise<LinkRecord | null>} insert Resolves `null` when the code is already taken.
 * @property {(code: string) => Promise<LinkRecord | null>} findByCode Includes soft-deleted rows, so callers can tell "gone" from "never existed".
 * @property {(params: ListLinksParams) => Promise<LinkRecord[]>} listByUser
 * @property {(code: string, patch: LinkPatch) => Promise<LinkRecord | null>} update Resolves `null` if the link does not exist or was deleted.
 * @property {(code: string) => Promise<boolean>} softDelete
 */

const COLUMNS =
  'id, code, original_url, user_id, is_active, expires_at, click_count, created_at, updated_at, deleted_at';

const toRecord = (row) => ({
  id: row.id,
  code: row.code,
  originalUrl: row.original_url,
  userId: row.user_id,
  isActive: row.is_active,
  expiresAt: row.expires_at,
  clickCount: row.click_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at,
});

/** Escapes LIKE wildcards so user input is matched literally. */
const escapeLike = (value) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** @implements {LinkStore} */
export class LinkRepository {
  #db;

  /** @param {import('pg').Pool} db */
  constructor(db) {
    this.#db = db;
  }

  async insert(link) {
    const { rows } = await this.#db.query(
      `INSERT INTO links (code, original_url, user_id, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO NOTHING
       RETURNING ${COLUMNS}`,
      [link.code, link.originalUrl, link.userId, link.expiresAt],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findByCode(code) {
    const { rows } = await this.#db.query(`SELECT ${COLUMNS} FROM links WHERE code = $1`, [code]);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async listByUser(params) {
    const pattern = params.search ? `%${escapeLike(params.search)}%` : null;
    const { rows } = await this.#db.query(
      `SELECT ${COLUMNS} FROM links
       WHERE user_id = $1
         AND deleted_at IS NULL
         AND ($2::bigint IS NULL OR id < $2)
         AND ($3::text IS NULL OR code ILIKE $3 OR original_url ILIKE $3)
       ORDER BY id DESC
       LIMIT $4`,
      [params.userId, params.beforeId ?? null, pattern, params.limit],
    );
    return rows.map(toRecord);
  }

  async update(code, patch) {
    const assignments = [];
    const values = [];
    const set = (column, value) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };

    // Column names below are literals from this file, never user input.
    if (patch.originalUrl !== undefined) set('original_url', patch.originalUrl);
    if (patch.isActive !== undefined) set('is_active', patch.isActive);
    if (patch.expiresAt !== undefined) set('expires_at', patch.expiresAt);
    if (assignments.length === 0) return this.findByCode(code);

    values.push(code);
    const { rows } = await this.#db.query(
      `UPDATE links SET ${assignments.join(', ')}, updated_at = now()
       WHERE code = $${values.length} AND deleted_at IS NULL
       RETURNING ${COLUMNS}`,
      values,
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async softDelete(code) {
    const { rowCount } = await this.#db.query(
      `UPDATE links SET deleted_at = now(), updated_at = now()
       WHERE code = $1 AND deleted_at IS NULL`,
      [code],
    );
    return (rowCount ?? 0) > 0;
  }
}
