import { setTimeout as sleep } from 'node:timers/promises';
import { enrichClick } from './click-enricher.js';
import { EVENT_FIELD, clickEventSchema } from './click-events.js';

/**
 * A stream entry as returned by Redis: `[id, [field, value, ...]]`. `fields` is null when the
 * entry was trimmed from the stream while still pending.
 * @typedef {[string, string[] | null]} StreamEntry
 */

/**
 * @typedef {object} ClickConsumerOptions
 * @property {string} streamKey
 * @property {string} group
 * @property {string} consumerName Unique per worker process.
 * @property {number} batchSize
 * @property {number} blockMs How long one blocking read waits for new events.
 * @property {number} reclaimIdleMs A pending entry idle for longer than this is presumed abandoned by a crashed worker.
 * @property {number} [reclaimIntervalMs] How often to look for abandoned entries (default 30 s).
 */

/**
 * @typedef {object} ClickConsumerDeps
 * @property {import('ioredis').Redis} redis Needs its own connection: XREADGROUP BLOCK would otherwise stall every other command on it.
 * @property {import('./click.repository.js').ClickWriter} writer
 * @property {import('pino').Logger} logger
 * @property {ClickConsumerOptions} options
 * @property {(event: import('./click-events.js').ClickEvent) => import('./click-events.js').ProcessedClick} [enrich]
 * @property {() => Promise<void>} [heartbeat] Called after every successful poll (also when idle). Wire it to a
 *   liveness probe: a worker that keeps failing or hangs stops calling it, which is how an orchestrator notices.
 */

const MAX_BACKOFF_MS = 30_000;

/**
 * Drains the click stream into Postgres with at-least-once delivery:
 *   read batch -> enrich -> one idempotent INSERT -> XACK.
 * A crash between INSERT and XACK only causes a redelivery, which the unique event id absorbs.
 * Several workers can share one consumer group to scale out.
 */
export class ClickConsumer {
  #redis;
  #writer;
  #logger;
  #options;
  #enrich;
  #heartbeat;

  #running = false;
  #groupReady = false;
  /**
   * True at startup and after a failed batch: entries this worker already received but never
   * acknowledged are not returned by `>` reads, so they must be re-read explicitly (id "0").
   */
  #drainOwnPending = true;
  #lastReclaimAt = 0;
  #wakeUp = new AbortController();

  /** @param {ClickConsumerDeps} deps */
  constructor(deps) {
    this.#redis = deps.redis;
    this.#writer = deps.writer;
    this.#logger = deps.logger;
    this.#enrich = deps.enrich ?? enrichClick;
    this.#heartbeat = deps.heartbeat;
    this.#options = { reclaimIntervalMs: 30_000, ...deps.options };
  }

  /** Runs until `stop()` is called. Errors are retried with exponential backoff. */
  async run() {
    this.#running = true;
    let failures = 0;

    while (this.#running) {
      try {
        await this.processOnce();
        failures = 0;
        await this.#heartbeat?.().catch((err) => {
          this.#logger.warn({ err }, 'could not write heartbeat');
        });
      } catch (err) {
        failures += 1;
        this.#groupReady = false; // e.g. Redis was flushed: recreate the group on the next pass
        const delayMs = Math.min(1_000 * 2 ** (failures - 1), MAX_BACKOFF_MS);
        this.#logger.error({ err, failures, delayMs }, 'click batch failed; will retry');
        await sleep(delayMs, undefined, { signal: this.#wakeUp.signal }).catch(() => undefined);
      }
    }
  }

  stop() {
    this.#running = false;
    this.#wakeUp.abort();
    this.#wakeUp = new AbortController();
  }

  /** Handles at most one batch and returns how many stream entries it consumed. */
  async processOnce() {
    if (!this.#groupReady) {
      await this.#ensureGroup();
      this.#groupReady = true;
    }

    const entries = await this.#readBatch();
    if (entries.length === 0) return 0;

    try {
      await this.#handle(entries);
    } catch (err) {
      this.#drainOwnPending = true; // retry this same batch on the next pass, without waiting to be reclaimed
      throw err;
    }
    return entries.length;
  }

  async #ensureGroup() {
    try {
      // Starting at "0" means events published before the first worker started are not lost.
      await this.#redis.xgroup(
        'CREATE',
        this.#options.streamKey,
        this.#options.group,
        '0',
        'MKSTREAM',
      );
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
    }
  }

  async #readBatch() {
    if (this.#drainOwnPending) {
      const own = await this.#readGroup('0');
      if (own.length > 0) return own;
      this.#drainOwnPending = false;
    }

    if (Date.now() - this.#lastReclaimAt >= this.#options.reclaimIntervalMs) {
      this.#lastReclaimAt = Date.now();
      const reclaimed = await this.#reclaimAbandoned();
      if (reclaimed.length > 0) return reclaimed;
    }

    return this.#readGroup('>');
  }

  /** `>` = entries never delivered to anyone (blocks briefly); `0` = this worker's unacknowledged ones. */
  async #readGroup(id) {
    const { streamKey, group, consumerName, batchSize, blockMs } = this.#options;
    const reply = await this.#redis.call(
      'XREADGROUP',
      'GROUP',
      group,
      consumerName,
      'COUNT',
      batchSize,
      ...(id === '>' ? ['BLOCK', blockMs] : []),
      'STREAMS',
      streamKey,
      id,
    );

    return reply?.[0]?.[1] ?? [];
  }

  /** Takes over entries that another (crashed) worker read but never acknowledged. */
  async #reclaimAbandoned() {
    const { streamKey, group, consumerName, batchSize, reclaimIdleMs } = this.#options;
    const reply = await this.#redis.call(
      'XAUTOCLAIM',
      streamKey,
      group,
      consumerName,
      reclaimIdleMs,
      '0-0',
      'COUNT',
      batchSize,
    );

    if (reply[1].length > 0) {
      this.#logger.warn({ count: reply[1].length }, 'reclaimed click events from a stalled worker');
    }
    return reply[1];
  }

  async #handle(entries) {
    const clicks = entries.flatMap(([id, fields]) => this.#parse(id, fields) ?? []);

    if (clicks.length > 0) {
      const inserted = await this.#writer.insertBatch(clicks);
      this.#logger.debug({ received: entries.length, inserted }, 'click batch stored');
    }

    // Malformed entries are acknowledged too: retrying can never fix them.
    const ids = entries.map(([id]) => id);
    const results = await this.#redis
      .multi()
      .xack(this.#options.streamKey, this.#options.group, ...ids)
      .xdel(this.#options.streamKey, ...ids)
      .exec();

    const failure = results?.find(([err]) => err !== null)?.[0];
    if (failure) throw failure;
  }

  #parse(id, fields) {
    try {
      const raw = fields?.[fields.indexOf(EVENT_FIELD) + 1];
      if (raw === undefined) throw new Error(`missing "${EVENT_FIELD}" field`);
      return this.#enrich(clickEventSchema.parse(JSON.parse(raw)));
    } catch (err) {
      this.#logger.error({ err, entryId: id }, 'dropping malformed click event');
      return null;
    }
  }
}
