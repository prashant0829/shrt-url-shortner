import pg from 'pg';
import { runMigrations } from './migrate.js';

// Reads only DATABASE_URL, so the migration job needs no unrelated secrets.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

try {
  const applied = await runMigrations(pool);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
