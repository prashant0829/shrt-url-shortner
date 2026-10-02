import pg from 'pg';

const { Pool, types } = pg;

/** pg_type OID of BIGINT / int8. */
const INT8_OID = 20;

/**
 * Postgres returns BIGINT (ids, counters, count(*)) as strings. Ours stay far below 2^53,
 * so they are parsed as numbers for this pool only, without touching global parser state.
 */
function getTypeParser(oid, format) {
  if (oid === INT8_OID) return (value) => Number(value);
  return types.getTypeParser(oid, format);
}

const customTypes = {
  getTypeParser: getTypeParser,
};

export function createPool(config, logger) {
  const pool = new Pool({
    connectionString: config.url,
    max: config.poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Guards the pool against a runaway analytics query.
    statement_timeout: 10_000,
    application_name: 'url-shortener',
    options: '-c timezone=UTC',
    types: customTypes,
  });

  // Without a listener, an error on an idle client would crash the process.
  pool.on('error', (err) => logger.error({ err }, 'unexpected error on idle postgres client'));
  return pool;
}
