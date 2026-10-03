import { z } from 'zod';
import {
  COUNTRY_CODE_LENGTH,
  MAX_REFERRER_LENGTH,
  MAX_USER_AGENT_LENGTH,
  MAX_VISITOR_HASH_LENGTH,
} from '../constants.js';

// What the redirect publishes. It carries raw request data (user agent, referrer) so the hot path
// stays cheap; parsing and classification happen later in the worker.
export const clickEventSchema = z.object({
  // Unique per click: the database uses it to make replays harmless.
  eventId: z.uuid(),
  linkId: z.number().int().positive(),
  occurredAt: z.iso.datetime(),
  visitorHash: z.string().min(1).max(MAX_VISITOR_HASH_LENGTH),
  userAgent: z.string().max(MAX_USER_AGENT_LENGTH).nullable(),
  referrer: z.string().max(MAX_REFERRER_LENGTH).nullable(),
  country: z.string().length(COUNTRY_CODE_LENGTH).nullable(),
});
