import { CLICK_EVENT_FIELD } from '../constants.js';

// Publishes click events to a Redis Stream. The stream is length-capped: if the worker is down for
// long, the oldest events are dropped instead of exhausting memory.
export function createRedisClickPublisher(redis, { streamKey, maxLength }) {
  async function publish(event) {
    // `MAXLEN ~` trims in whole chunks, which is much cheaper than trimming to the exact length.
    await redis.xadd(
      streamKey,
      'MAXLEN',
      '~',
      maxLength,
      '*',
      CLICK_EVENT_FIELD,
      JSON.stringify(event),
    );
  }

  return { publish };
}
