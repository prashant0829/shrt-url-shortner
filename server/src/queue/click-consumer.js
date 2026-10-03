import { setTimeout as sleep } from 'node:timers/promises';
import { CLICK_EVENT_FIELD, ONE_SECOND_MS } from '../constants.js';
import { enrichClick } from '../utils/click-enricher.js';
import { clickEventSchema } from '../schemas/click-event.schemas.js';

const INITIAL_RETRY_DELAY_MS = ONE_SECOND_MS;
const MAX_RETRY_DELAY_MS = 30 * ONE_SECOND_MS;
const DEFAULT_RECLAIM_INTERVAL_MS = 30 * ONE_SECOND_MS;

// Entry ids understood by XREADGROUP.
const NEVER_DELIVERED = '>';
const OWN_PENDING = '0';

// Drains the click stream into Postgres with at-least-once delivery:
//   read a batch -> enrich -> one idempotent INSERT -> acknowledge.
// A crash between the INSERT and the acknowledgement only causes a redelivery, which the unique
// event id absorbs. Several workers can share one consumer group to scale out.
//
// `redis` needs its own connection, because XREADGROUP BLOCK would stall every other command on it.
// `options.reclaimIdleMs`: a pending entry idle for longer is presumed abandoned by a crashed worker.
// `heartbeat` runs after every successful poll, idle ones included. A worker that keeps failing or
// hangs stops calling it, which is how a container health check notices.
export function createClickConsumer({
  redis,
  writer,
  logger,
  options,
  enrich = enrichClick,
  heartbeat,
}) {
  const settings = { reclaimIntervalMs: DEFAULT_RECLAIM_INTERVAL_MS, ...options };

  let running = false;
  let consumerGroupReady = false;
  let lastReclaimAt = 0;
  let interruptBackoff = new AbortController();

  // True at start-up and after a failed batch: entries this worker already received but never
  // acknowledged are not returned by `>` reads, so they must be re-read explicitly.
  let shouldDrainOwnPending = true;

  async function ensureConsumerGroup() {
    const { streamKey, group } = settings;
    try {
      // Starting at "0" means events published before the first worker started are not lost.
      await redis.xgroup('CREATE', streamKey, group, '0', 'MKSTREAM');
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
    }
  }

  // `NEVER_DELIVERED` blocks briefly waiting for new entries; `OWN_PENDING` returns immediately.
  async function readGroup(entryId) {
    const { streamKey, group, consumerName, batchSize, blockMs } = settings;
    const blockArgs = entryId === NEVER_DELIVERED ? ['BLOCK', blockMs] : [];

    const reply = await redis.call(
      'XREADGROUP',
      'GROUP',
      group,
      consumerName,
      'COUNT',
      batchSize,
      ...blockArgs,
      'STREAMS',
      streamKey,
      entryId,
    );
    return reply?.[0]?.[1] ?? [];
  }

  async function reclaimAbandoned() {
    const { streamKey, group, consumerName, batchSize, reclaimIdleMs } = settings;
    const reply = await redis.call(
      'XAUTOCLAIM',
      streamKey,
      group,
      consumerName,
      reclaimIdleMs,
      '0-0',
      'COUNT',
      batchSize,
    );

    const reclaimedEntries = reply[1];
    if (reclaimedEntries.length > 0) {
      logger.warn(
        { count: reclaimedEntries.length },
        'reclaimed click events from a stalled worker',
      );
    }
    return reclaimedEntries;
  }

  async function readBatch() {
    if (shouldDrainOwnPending) {
      const ownPending = await readGroup(OWN_PENDING);
      if (ownPending.length > 0) return ownPending;
      shouldDrainOwnPending = false;
    }

    if (Date.now() - lastReclaimAt >= settings.reclaimIntervalMs) {
      lastReclaimAt = Date.now();
      const reclaimed = await reclaimAbandoned();
      if (reclaimed.length > 0) return reclaimed;
    }

    return readGroup(NEVER_DELIVERED);
  }

  function parseEntry(entryId, fields) {
    try {
      const rawEvent = fields?.[fields.indexOf(CLICK_EVENT_FIELD) + 1];
      if (rawEvent === undefined) throw new Error(`missing "${CLICK_EVENT_FIELD}" field`);
      return enrich(clickEventSchema.parse(JSON.parse(rawEvent)));
    } catch (err) {
      logger.error({ err, entryId }, 'dropping malformed click event');
      return null;
    }
  }

  // A stream entry is `[entryId, [field, value, ...]]`; `fields` is null if the entry was trimmed
  // from the stream while still pending.
  async function storeBatch(entries) {
    const { streamKey, group } = settings;
    const clicks = entries.flatMap(([entryId, fields]) => parseEntry(entryId, fields) ?? []);

    if (clicks.length > 0) {
      const inserted = await writer.insertBatch(clicks);
      logger.debug({ received: entries.length, inserted }, 'click batch stored');
    }

    // Malformed entries are acknowledged too: retrying can never fix them.
    const entryIds = entries.map(([entryId]) => entryId);
    const results = await redis
      .multi()
      .xack(streamKey, group, ...entryIds)
      .xdel(streamKey, ...entryIds)
      .exec();

    const failure = results?.find(([err]) => err !== null)?.[0];
    if (failure) throw failure;
  }

  // Handles at most one batch and returns how many stream entries it consumed.
  async function processOnce() {
    if (!consumerGroupReady) {
      await ensureConsumerGroup();
      consumerGroupReady = true;
    }

    const entries = await readBatch();
    if (entries.length === 0) return 0;

    try {
      await storeBatch(entries);
    } catch (err) {
      shouldDrainOwnPending = true; // retry this same batch next pass instead of waiting to be reclaimed
      throw err;
    }
    return entries.length;
  }

  // Runs until `stop()` is called. A failed batch is retried with exponential backoff.
  async function run() {
    running = true;
    let consecutiveFailures = 0;

    while (running) {
      try {
        await processOnce();
        consecutiveFailures = 0;
        await heartbeat?.().catch((err) => {
          logger.warn({ err }, 'could not write heartbeat');
        });
      } catch (err) {
        consecutiveFailures += 1;
        consumerGroupReady = false; // e.g. Redis was flushed: recreate the group next pass

        const delayMs = Math.min(
          INITIAL_RETRY_DELAY_MS * 2 ** (consecutiveFailures - 1),
          MAX_RETRY_DELAY_MS,
        );
        logger.error(
          { err, failures: consecutiveFailures, delayMs },
          'click batch failed; will retry',
        );
        await sleep(delayMs, undefined, { signal: interruptBackoff.signal }).catch(() => undefined);
      }
    }
  }

  function stop() {
    running = false;
    interruptBackoff.abort();
    interruptBackoff = new AbortController();
  }

  return { run, stop, processOnce };
}
