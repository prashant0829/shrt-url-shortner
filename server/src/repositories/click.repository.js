import { AnalyticsInterval, BREAKDOWN_ROW_LIMIT } from '../constants.js';

const SQL_INTERVAL_STEP = {
  [AnalyticsInterval.HOUR]: '1 hour',
  [AnalyticsInterval.DAY]: '1 day',
};

export function createClickRepository(db) {
  // Stores the clicks and resolves how many were new (replayed events are ignored).
  async function insertBatch(clicks) {
    if (clicks.length === 0) return 0;

    const columnValues = (field) => clicks.map((click) => click[field]);

    // One statement, one round trip: unnest() turns the column arrays back into rows.
    //  - JOIN links drops events for links that no longer exist instead of failing the batch.
    //  - ON CONFLICT (event_id) DO NOTHING makes redelivered events harmless (at-least-once).
    //  - The counter is bumped only for rows that were really inserted, and bots are excluded so
    //    links.click_count matches the default (human-only) analytics view.
    const { rows } = await db.query(
      `WITH incoming AS (
         SELECT * FROM unnest(
           $1::uuid[], $2::bigint[], $3::timestamptz[], $4::text[], $5::text[],
           $6::text[], $7::text[], $8::text[], $9::text[], $10::boolean[]
         ) AS t(event_id, link_id, clicked_at, visitor_hash, country,
                referrer_host, browser, os, device_type, is_bot)
       ),
       inserted AS (
         INSERT INTO clicks (event_id, link_id, clicked_at, visitor_hash, country,
                             referrer_host, browser, os, device_type, is_bot)
         SELECT i.event_id, i.link_id, i.clicked_at, i.visitor_hash, i.country,
                i.referrer_host, i.browser, i.os, i.device_type, i.is_bot
         FROM incoming i
         JOIN links l ON l.id = i.link_id
         ON CONFLICT (event_id) DO NOTHING
         RETURNING link_id, is_bot
       ),
       bumped AS (
         UPDATE links l
         SET click_count = l.click_count + c.human_clicks
         FROM (
           SELECT link_id, count(*) FILTER (WHERE NOT is_bot) AS human_clicks
           FROM inserted
           GROUP BY link_id
           HAVING count(*) FILTER (WHERE NOT is_bot) > 0
         ) c
         WHERE l.id = c.link_id
       )
       SELECT count(*)::int AS inserted FROM inserted`,
      [
        columnValues('eventId'),
        columnValues('linkId'),
        columnValues('occurredAt'),
        columnValues('visitorHash'),
        columnValues('country'),
        columnValues('referrerHost'),
        columnValues('browser'),
        columnValues('os'),
        columnValues('deviceType'),
        columnValues('isBot'),
      ],
    );
    return rows[0]?.inserted ?? 0;
  }

  // Totals, a time series (empty buckets included, so charts need no gap filling) and the top
  // values for each breakdown. `from` is inclusive and `to` exclusive.
  async function getReport({ linkId, from, to, interval, includeBots }) {
    const [totalsResult, seriesResult, breakdownResult] = await Promise.all([
      db.query(
        `SELECT count(*)::int AS clicks, count(DISTINCT visitor_hash)::int AS unique_visitors
         FROM clicks
         WHERE link_id = $1 AND clicked_at >= $2 AND clicked_at < $3
           AND ($4::boolean OR NOT is_bot)`,
        [linkId, from, to, includeBots],
      ),
      // Aggregate once with a single index range scan, then LEFT JOIN onto a generated series so
      // buckets without clicks still appear (as zero).
      db.query(
        `WITH hits AS (
           SELECT date_trunc($4::text, clicked_at, 'UTC') AS bucket, count(*)::int AS clicks
           FROM clicks
           WHERE link_id = $1 AND clicked_at >= $2 AND clicked_at < $3
             AND ($5::boolean OR NOT is_bot)
           GROUP BY 1
         )
         SELECT b.bucket, COALESCE(h.clicks, 0)::int AS clicks
         FROM generate_series(
                date_trunc($4::text, $2::timestamptz, 'UTC'),
                $3::timestamptz - interval '1 microsecond',
                $6::interval
              ) AS b(bucket)
         LEFT JOIN hits h ON h.bucket = b.bucket
         ORDER BY b.bucket`,
        [linkId, from, to, interval, includeBots, SQL_INTERVAL_STEP[interval]],
      ),
      // All five breakdowns in one round trip: filter once, group five ways, keep the top rows of each.
      db.query(
        `WITH f AS (
           SELECT country, browser, os, device_type, referrer_host
           FROM clicks
           WHERE link_id = $1 AND clicked_at >= $2 AND clicked_at < $3
             AND ($4::boolean OR NOT is_bot)
         ),
         d AS (
           SELECT 'country' AS dimension, COALESCE(country, 'Unknown') AS label, count(*) AS clicks FROM f GROUP BY 2
           UNION ALL
           SELECT 'browser', COALESCE(browser, 'Unknown'), count(*) FROM f GROUP BY 2
           UNION ALL
           SELECT 'os', COALESCE(os, 'Unknown'), count(*) FROM f GROUP BY 2
           UNION ALL
           SELECT 'device', device_type, count(*) FROM f GROUP BY 2
           UNION ALL
           SELECT 'referrer', COALESCE(referrer_host, 'Direct'), count(*) FROM f GROUP BY 2
         ),
         ranked AS (
           SELECT dimension, label, clicks,
                  row_number() OVER (PARTITION BY dimension ORDER BY clicks DESC, label) AS rank
           FROM d
         )
         SELECT dimension, label, clicks::int AS clicks
         FROM ranked
         WHERE rank <= $5
         ORDER BY dimension, rank`,
        [linkId, from, to, includeBots, BREAKDOWN_ROW_LIMIT],
      ),
    ]);

    const topEntries = (dimension) =>
      breakdownResult.rows
        .filter((row) => row.dimension === dimension)
        .map(({ label, clicks }) => ({ label, clicks }));

    return {
      totals: {
        clicks: totalsResult.rows[0]?.clicks ?? 0,
        uniqueVisitors: totalsResult.rows[0]?.unique_visitors ?? 0,
      },
      series: seriesResult.rows,
      breakdowns: {
        countries: topEntries('country'),
        browsers: topEntries('browser'),
        operatingSystems: topEntries('os'),
        devices: topEntries('device'),
        referrers: topEntries('referrer'),
      },
    };
  }

  return { insertBatch, getReport };
}
