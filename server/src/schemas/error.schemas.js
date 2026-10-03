import { z } from 'zod';

export const errorResponse = z.object({
  error: z.object({
    code: z.string().describe('Stable machine-readable error code'),
    message: z.string(),
    details: z.unknown().optional(),
  }),
  requestId: z.string().describe('Quote this when reporting a problem'),
});

// Documents the given error statuses; they all share the standard error body.
export const errorResponses = (...statuses) =>
  Object.fromEntries(statuses.map((status) => [status, errorResponse]));
