const USER_COLUMNS = 'id, email, password_hash, created_at';

const rowToUser = (row) => ({
  id: row.id,
  email: row.email,
  passwordHash: row.password_hash,
  createdAt: row.created_at,
});

export function createUserRepository(db) {
  // Resolves null when the email is already registered.
  async function create({ email, passwordHash }) {
    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING ${USER_COLUMNS}`,
      [email, passwordHash],
    );
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async function findByEmail(email) {
    const { rows } = await db.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE lower(email) = lower($1)`,
      [email],
    );
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async function findById(id) {
    const { rows } = await db.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  return { create, findByEmail, findById };
}
