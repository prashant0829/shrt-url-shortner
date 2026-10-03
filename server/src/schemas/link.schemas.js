import { z } from 'zod';
import {
  DEFAULT_LINKS_PAGE_SIZE,
  DEFAULT_QR_SIZE,
  MAX_CODE_PARAM_LENGTH,
  MAX_LINKS_PAGE_SIZE,
  MAX_PAGINATION_CURSOR_LENGTH,
  MAX_QR_SIZE,
  MAX_SEARCH_LENGTH,
  MAX_URL_LENGTH,
  MIN_QR_SIZE,
  QrFormat,
  SHORT_CODE_MAX_LENGTH,
  SHORT_CODE_MIN_LENGTH,
  SHORT_CODE_PATTERN,
} from '../constants.js';

const isoDateTime = z.iso.datetime({ offset: true });
const destinationUrl = z.string().trim().min(1).max(MAX_URL_LENGTH);

export const codeParams = z.object({
  code: z.string().min(1).max(MAX_CODE_PARAM_LENGTH).describe('Short code or custom alias'),
});

// The redirect route skips the length checks of `codeParams` on purpose: a malformed code is simply
// answered with 404 without touching the cache or the database.
export const redirectParams = z.object({
  code: z.string().describe('Short code or custom alias'),
});

export const createLinkBody = z.object({
  url: destinationUrl.describe('Destination URL (http or https)'),
  customAlias: z
    .string()
    .regex(
      SHORT_CODE_PATTERN,
      `${SHORT_CODE_MIN_LENGTH}-${SHORT_CODE_MAX_LENGTH} characters: letters, digits, "-" or "_"`,
    )
    .optional()
    .describe('Optional vanity code instead of a generated one'),
  expiresAt: isoDateTime.optional().describe('ISO-8601 time after which the link stops working'),
});

export const updateLinkBody = z
  .object({
    url: destinationUrl.optional(),
    isActive: z.boolean().optional(),
    expiresAt: isoDateTime.nullable().optional().describe('Set to null to remove the expiry'),
  })
  .refine((body) => Object.keys(body).length > 0, 'At least one field must be provided');

export const listLinksQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LINKS_PAGE_SIZE).default(DEFAULT_LINKS_PAGE_SIZE),
  cursor: z
    .string()
    .max(MAX_PAGINATION_CURSOR_LENGTH)
    .optional()
    .describe('`nextCursor` from the previous page'),
  q: z
    .string()
    .trim()
    .min(1)
    .max(MAX_SEARCH_LENGTH)
    .optional()
    .describe('Filter by code or destination'),
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
  format: z.enum(Object.values(QrFormat)).default(QrFormat.PNG),
  size: z.coerce
    .number()
    .int()
    .min(MIN_QR_SIZE)
    .max(MAX_QR_SIZE)
    .default(DEFAULT_QR_SIZE)
    .describe('Width in pixels (PNG only)'),
});
