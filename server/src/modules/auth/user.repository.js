/**
 * @typedef {object} UserRecord
 * @property {string} id
 * @property {string} email
 * @property {string} passwordHash
 * @property {Date} createdAt
 */

/**
 * Persistence port used by the auth service; lets unit tests swap in an in-memory fake.
 * @typedef {object} UserStore
 * @property {(input: {email: string, passwordHash: string}) => Promise<UserRecord | null>} create Resolves `null` when the email is already registered.
 * @property {(email: string) => Promise<UserRecord | null>} findByEmail
 * @property {(id: string) => Promise<UserRecord | null>} findById
 */

const COLUMNS = 'id, email, password_hash, created_at';

const toRecord = (row) => ({
  id: row.id,
  email: row.email,
  passwordHash: row.password_hash,
  createdAt: row.created_at,
});

/** @implements {UserStore} */
export class UserRepository {
  #db;

  /** @param {import('pg').Pool} db */
  constructor(db) {
    this.#db = db;
  }

  async create(input) {
    const { rows } = await this.#db.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING ${COLUMNS}`,
      [input.email, input.passwordHash],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findByEmail(email) {
    const { rows } = await this.#db.query(
      `SELECT ${COLUMNS} FROM users WHERE lower(email) = lower($1)`,
      [email],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findById(id) {
    const { rows } = await this.#db.query(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
    return rows[0] ? toRecord(rows[0]) : null;
  }
}
