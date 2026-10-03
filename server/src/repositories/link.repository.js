const LINK_COLUMNS =
  'id, code, original_url, user_id, is_active, expires_at, click_count, created_at, updated_at, deleted_at';

const rowToLink = (row) => ({
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

// Escapes LIKE wildcards so user input is matched literally.
const escapeLike = (value) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export function createLinkRepository(db) {
  // Resolves null when the code is already taken.
  async function insert({ code, originalUrl, userId, expiresAt }) {
    const { rows } = await db.query(
      `INSERT INTO links (code, original_url, user_id, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO NOTHING
       RETURNING ${LINK_COLUMNS}`,
      [code, originalUrl, userId, expiresAt],
    );
    return rows[0] ? rowToLink(rows[0]) : null;
  }

  // Includes soft-deleted rows, so callers can tell "gone" from "never existed".
  async function findByCode(code) {
    const { rows } = await db.query(`SELECT ${LINK_COLUMNS} FROM links WHERE code = $1`, [code]);
    return rows[0] ? rowToLink(rows[0]) : null;
  }

  // `beforeId` is the keyset cursor: only links with a lower id are returned.
  async function listByUser({ userId, limit, beforeId, search }) {
    const pattern = search ? `%${escapeLike(search)}%` : null;
    const { rows } = await db.query(
      `SELECT ${LINK_COLUMNS} FROM links
       WHERE user_id = $1
         AND deleted_at IS NULL
         AND ($2::bigint IS NULL OR id < $2)
         AND ($3::text IS NULL OR code ILIKE $3 OR original_url ILIKE $3)
       ORDER BY id DESC
       LIMIT $4`,
      [userId, beforeId ?? null, pattern, limit],
    );
    return rows.map(rowToLink);
  }

  // Resolves null if the link does not exist or was deleted.
  async function update(code, { originalUrl, isActive, expiresAt }) {
    const assignments = [];
    const values = [];
    const setColumn = (column, value) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };

    // Column names are literals from this file, never user input.
    if (originalUrl !== undefined) setColumn('original_url', originalUrl);
    if (isActive !== undefined) setColumn('is_active', isActive);
    if (expiresAt !== undefined) setColumn('expires_at', expiresAt);
    if (assignments.length === 0) return findByCode(code);

    values.push(code);
    const { rows } = await db.query(
      `UPDATE links SET ${assignments.join(', ')}, updated_at = now()
       WHERE code = $${values.length} AND deleted_at IS NULL
       RETURNING ${LINK_COLUMNS}`,
      values,
    );
    return rows[0] ? rowToLink(rows[0]) : null;
  }

  async function softDelete(code) {
    const { rowCount } = await db.query(
      `UPDATE links SET deleted_at = now(), updated_at = now()
       WHERE code = $1 AND deleted_at IS NULL`,
      [code],
    );
    return (rowCount ?? 0) > 0;
  }

  return { insert, findByCode, listByUser, update, softDelete };
}
