import { z } from 'zod';

/** Shape of every error response the API returns. */
export const errorResponse = z.object({
  error: z.object({
    code: z.string().describe('Stable machine-readable error code'),
    message: z.string(),
    details: z.unknown().optional(),
  }),
  requestId: z.string().describe('Quote this when reporting a problem'),
});
