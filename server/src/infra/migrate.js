import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Any fixed number works: runners that start together take turns on the same advisory lock.
const MIGRATION_LOCK_ID = 727_001;

export const DEFAULT_MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../migrations');

// Applies the `NNN_name.sql` files that have not run yet, in order, each in its own transaction.
// Returns the names of the migrations applied by this call.
export async function runMigrations(pool, migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  const client = await pool.connect();
  const newlyApplied = [];

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text        PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const alreadyApplied = new Set(rows.map((row) => row.name));
    const migrationFiles = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of migrationFiles) {
      if (alreadyApplied.has(file)) continue;

      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`, { cause: err });
      }
      newlyApplied.push(file);
    }
    return newlyApplied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
