import pg from 'pg';
import { SERVICE_NAME } from '../constants.js';

const { Pool, types } = pg;

const BIGINT_TYPE_OID = 20;
const IDLE_CLIENT_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 5_000;
const STATEMENT_TIMEOUT_MS = 10_000;

// Postgres returns BIGINT (ids, counters, count(*)) as strings. Ours stay far below 2^53, so this
// pool parses them as numbers without touching pg's global parsers.
const typeParsers = {
  getTypeParser: (oid, format) =>
    oid === BIGINT_TYPE_OID ? (value) => Number(value) : types.getTypeParser(oid, format),
};

export function createPool({ url, poolMax }, logger) {
  const pool = new Pool({
    connectionString: url,
    max: poolMax,
    idleTimeoutMillis: IDLE_CLIENT_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    application_name: SERVICE_NAME,
    options: '-c timezone=UTC',
    types: typeParsers,
  });

  // Without a listener, an error on an idle client would crash the process.
  pool.on('error', (err) => logger.error({ err }, 'unexpected error on idle postgres client'));
  return pool;
}
