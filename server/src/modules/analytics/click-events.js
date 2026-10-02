import { z } from 'zod';

/** Name of the single stream field that carries the JSON-encoded event. */
export const EVENT_FIELD = 'event';

/**
 * What the redirect path publishes. It carries raw request data (user agent, referrer) so the
 * hot path stays cheap; parsing and classification happen later in the worker.
 */
export const clickEventSchema = z.object({
  /** Unique per click: the database uses it to make replays idempotent. */
  eventId: z.uuid(),
  linkId: z.number().int().positive(),
  occurredAt: z.iso.datetime(),
  visitorHash: z.string().min(1).max(64),
  userAgent: z.string().max(512).nullable(),
  referrer: z.string().max(2048).nullable(),
  country: z.string().length(2).nullable(),
});

/** @typedef {import('zod').infer<typeof clickEventSchema>} ClickEvent */

/** @typedef {'desktop' | 'mobile' | 'tablet' | 'tv' | 'unknown'} DeviceType */

/**
 * A click after enrichment, ready to be stored.
 * @typedef {object} ProcessedClick
 * @property {string} eventId
 * @property {number} linkId
 * @property {Date} occurredAt
 * @property {string} visitorHash
 * @property {string | null} country
 * @property {string | null} referrerHost
 * @property {string | null} browser
 * @property {string | null} os
 * @property {DeviceType} deviceType
 * @property {boolean} isBot
 */

/**
 * Transport port: today a Redis Stream, replaceable by Kafka/SQS without touching callers.
 * @typedef {object} ClickPublisher
 * @property {(event: ClickEvent) => Promise<void>} publish
 */
