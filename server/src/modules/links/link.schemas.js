import { z } from 'zod';
import { CODE_PATTERN } from './link-code.js';

const isoDateTime = z.iso.datetime({ offset: true });

export const codeParams = z.object({
  code: z.string().min(1).max(64).describe('Short code or custom alias'),
});

export const createLinkBody = z.object({
  url: z.string().trim().min(1).max(2048).describe('Destination URL (http or https)'),
  customAlias: z
    .string()
    .regex(CODE_PATTERN, '3-32 characters: letters, digits, "-" or "_"')
    .optional()
    .describe('Optional vanity code instead of a generated one'),
  expiresAt: isoDateTime.optional().describe('ISO-8601 time after which the link stops working'),
});

export const updateLinkBody = z
  .object({
    url: z.string().trim().min(1).max(2048).optional(),
    isActive: z.boolean().optional(),
    expiresAt: isoDateTime.nullable().optional().describe('Set to null to remove the expiry'),
  })
  .refine((body) => Object.keys(body).length > 0, 'At least one field must be provided');

export const listLinksQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(64).optional().describe('`nextCursor` from the previous page'),
  q: z.string().trim().min(1).max(100).optional().describe('Filter by code or destination'),
});

export const linkView = z.object({
  code: z.string(),
  shortUrl: z.string(),
  originalUrl: z.string(),
  isActive: z.boolean(),
  expiresAt: z.string().nullable(),
  clickCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const linkListView = z.object({
  items: z.array(linkView),
  nextCursor: z.string().nullable().describe('Pass as `cursor` to fetch the next page'),
});

export const qrQuery = z.object({
  format: z.enum(['png', 'svg']).default('png'),
  size: z.coerce
    .number()
    .int()
    .min(64)
    .max(1024)
    .default(256)
    .describe('Width in pixels (PNG only)'),
});
