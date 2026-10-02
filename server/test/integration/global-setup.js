import pg from 'pg';
import { runMigrations } from '../../src/infra/migrate.js';
import { TEST_DATABASE_URL } from '../helpers/env.js';

/** Creates the test database if needed and brings its schema up to date, once per test run. */
export default async function setup() {
  const target = new URL(TEST_DATABASE_URL);
  const database = decodeURIComponent(target.pathname.slice(1));
  if (!database.includes('test')) {
    throw new Error(
      `Refusing to run integration tests against "${database}": its name must contain "test".`,
    );
  }

  const admin = new pg.Client({ connectionString: withDatabase(target, 'postgres') });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      'Cannot reach Postgres for integration tests. Start it with: npm run infra:up',
      {
        cause: err,
      },
    );
  }

  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.end();
  }

  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}

function withDatabase(url, database) {
  const copy = new URL(url);
  copy.pathname = `/${database}`;
  return copy.toString();
}
