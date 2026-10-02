import { EVENT_FIELD } from './click-events.js';

/**
 * @typedef {object} RedisClickPublisherOptions
 * @property {string} streamKey
 * @property {number} maxLength Safety cap: if the worker is down for long, the oldest events are dropped instead of exhausting memory.
 */

/** @implements {import('./click-events.js').ClickPublisher} */
export class RedisClickPublisher {
  #redis;
  #options;

  /**
   * @param {import('ioredis').Redis} redis
   * @param {RedisClickPublisherOptions} options
   */
  constructor(redis, options) {
    this.#redis = redis;
    this.#options = options;
  }

  async publish(event) {
    // MAXLEN ~ trims lazily in whole radix-tree nodes, which is much cheaper than exact trimming.
    await this.#redis.xadd(
      this.#options.streamKey,
      'MAXLEN',
      '~',
      this.#options.maxLength,
      '*',
      EVENT_FIELD,
      JSON.stringify(event),
    );
  }
}
