/**
 * Publishes fake historical clicks for one link into the Redis stream, so the analytics UI has
 * something to show. Events travel through the real pipeline: run the worker afterwards.
 *
 *   npm run seed:clicks -- <code> [count=200] [days=14]
 */
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import pg from 'pg';
import { clickEventSchema } from '../src/schemas/click-event.schemas.js';
import { CLICK_EVENT_FIELD, ONE_DAY_MS } from '../src/constants.js';

const [code, countArg = '200', daysArg = '14'] = process.argv.slice(2);
const { DATABASE_URL, REDIS_URL, CLICK_STREAM_KEY = 'clicks' } = process.env;

if (!code || !DATABASE_URL || !REDIS_URL) {
  console.error(
    'Usage: npm run seed:clicks -- <code> [count] [days]  (needs DATABASE_URL, REDIS_URL)',
  );
  process.exit(1);
}

const count = Number(countArg);
const days = Number(daysArg);

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bots.html)',
];
const COUNTRIES = ['IN', 'IN', 'US', 'US', 'US', 'DE', 'GB', 'BR', 'JP', null];
const REFERRERS = [
  'https://news.ycombinator.com/item?id=1',
  'https://www.google.com/search?q=short',
  'https://twitter.com/',
  'https://www.reddit.com/r/programming',
  null,
  null,
];

const pick = (items) => items[Math.floor(Math.random() * items.length)];

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
const redis = new Redis(REDIS_URL);

try {
  const { rows } = await pool.query('SELECT id FROM links WHERE code = $1 AND deleted_at IS NULL', [
    code,
  ]);
  const linkId = Number(rows[0]?.id);
  if (!linkId) throw new Error(`No active link with code "${code}"`);

  // A small pool of visitors, so unique visitors come out lower than total clicks.
  const visitors = Array.from({ length: Math.max(5, Math.floor(count / 4)) }, () =>
    randomUUID().replaceAll('-', '').slice(0, 22),
  );

  const pipeline = redis.pipeline();
  for (let i = 0; i < count; i++) {
    // Squaring the random number skews clicks towards recent days, like a real campaign.
    const ageMs = Math.floor(Math.random() ** 1.6 * days * ONE_DAY_MS);
    const event = clickEventSchema.parse({
      eventId: randomUUID(),
      linkId,
      occurredAt: new Date(Date.now() - ageMs).toISOString(),
      visitorHash: pick(visitors),
      userAgent: pick(USER_AGENTS),
      referrer: pick(REFERRERS),
      country: pick(COUNTRIES),
    });
    pipeline.xadd(CLICK_STREAM_KEY, '*', CLICK_EVENT_FIELD, JSON.stringify(event));
  }
  await pipeline.exec();
  console.log(
    `Queued ${count} clicks for "${code}" over ${days} days. Start the worker to store them.`,
  );
} finally {
  await pool.end();
  redis.disconnect();
}
