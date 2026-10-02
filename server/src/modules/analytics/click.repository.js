/** @typedef {'hour' | 'day'} Interval */

/**
 * @typedef {object} ReportQuery
 * @property {number} linkId
 * @property {Date} from Inclusive lower bound.
 * @property {Date} to Exclusive upper bound.
 * @property {Interval} interval
 * @property {boolean} includeBots
 */

/**
 * @typedef {object} BreakdownEntry
 * @property {string} label
 * @property {number} clicks
 */

/**
 * @typedef {object} ClickReport
 * @property {{clicks: number, uniqueVisitors: number}} totals
 * @property {{bucket: Date, clicks: number}[]} series One point per interval, including empty ones, so charts need no gap filling.
 * @property {{countries: BreakdownEntry[], browsers: BreakdownEntry[], operatingSystems: BreakdownEntry[],
 *   devices: BreakdownEntry[], referrers: BreakdownEntry[]}} breakdowns
 */

/**
 * @typedef {object} ClickWriter
 * @property {(clicks: import('./click-events.js').ProcessedClick[]) => Promise<number>} insertBatch
 *   Stores the clicks and resolves how many were new (replayed events are ignored).
 */

/**
 * @typedef {object} ClickReader
 * @property {(query: ReportQuery) => Promise<ClickReport>} getReport
 */

const BREAKDOWN_LIMIT = 10;
const INTERVAL_STEP = { hour: '1 hour', day: '1 day' };

/** @implements {ClickWriter} @implements {ClickReader} */
export class ClickRepository {
  #db;

  /** @param {import('pg').Pool} db */
  constructor(db) {
    this.#db = db;
  }

  async insertBatch(clicks) {
    if (clicks.length === 0) return 0;

    // One statement, one round trip: unnest() turns column arrays back into rows.
    //  - JOIN links drops events for links that no longer exist instead of failing the batch.
    //  - ON CONFLICT (event_id) DO NOTHING makes redelivered events harmless (at-least-once).
    //  - The counter is bumped only for rows that were really inserted, and bots are excluded so
    //    links.click_count matches the default (human-only) analytics view.
    const { rows } = await this.#db.query(
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
        clicks.map((c) => c.eventId),
        clicks.map((c) => c.linkId),
        clicks.map((c) => c.occurredAt),
        clicks.map((c) => c.visitorHash),
        clicks.map((c) => c.country),
        clicks.map((c) => c.referrerHost),
        clicks.map((c) => c.browser),
        clicks.map((c) => c.os),
        clicks.map((c) => c.deviceType),
        clicks.map((c) => c.isBot),
      ],
    );
    return rows[0]?.inserted ?? 0;
  }

  async getReport(query) {
    const { linkId, from, to, interval, includeBots } = query;

    const [totals, series, breakdown] = await Promise.all([
      this.#db.query(
        `SELECT count(*)::int AS clicks, count(DISTINCT visitor_hash)::int AS unique_visitors
         FROM clicks
         WHERE link_id = $1 AND clicked_at >= $2 AND clicked_at < $3
           AND ($4::boolean OR NOT is_bot)`,
        [linkId, from, to, includeBots],
      ),
      // Aggregate once with a single index range scan, then LEFT JOIN onto a generated series
      // so buckets without clicks still appear (as zero).
      this.#db.query(
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
        [linkId, from, to, interval, includeBots, INTERVAL_STEP[interval]],
      ),
      // All five breakdowns in one round trip: filter once, group five ways, keep the top N of each.
      this.#db.query(
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
        [linkId, from, to, includeBots, BREAKDOWN_LIMIT],
      ),
    ]);

    const pick = (dimension) =>
      breakdown.rows
        .filter((row) => row.dimension === dimension)
        .map(({ label, clicks }) => ({ label, clicks }));

    return {
      totals: {
        clicks: totals.rows[0]?.clicks ?? 0,
        uniqueVisitors: totals.rows[0]?.unique_visitors ?? 0,
      },
      series: series.rows,
      breakdowns: {
        countries: pick('country'),
        browsers: pick('browser'),
        operatingSystems: pick('os'),
        devices: pick('device'),
        referrers: pick('referrer'),
      },
    };
  }
}
