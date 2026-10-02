import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Arbitrary constant: serialises concurrent runners (e.g. several containers starting together).
const MIGRATION_LOCK_ID = 727_001;

// Resolves to <project>/migrations from both src/infra (dev) and dist/infra (built).
export const DEFAULT_MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../migrations');

/**
 * Applies pending `NNN_name.sql` files in filename order, each inside its own transaction.
 * Returns the names of the migrations that were applied by this call.
 */
export async function runMigrations(pool, dir = DEFAULT_MIGRATIONS_DIR) {
  const client = await pool.connect();
  const applied = [];

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text        PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((row) => row.name));
    const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();

    for (const file of files) {
      if (done.has(file)) continue;

      const sql = await readFile(path.join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`, { cause: err });
      }
      applied.push(file);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
