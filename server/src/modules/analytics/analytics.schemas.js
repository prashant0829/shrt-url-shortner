import { z } from 'zod';

export const analyticsQuery = z.object({
  from: z.iso
    .datetime({ offset: true })
    .optional()
    .describe('Start of range (default: 7 days ago)'),
  to: z.iso.datetime({ offset: true }).optional().describe('End of range (default: now)'),
  interval: z.enum(['hour', 'day']).default('day').describe('Time-series bucket size'),
  includeBots: z.stringbool().default(false).describe('Count crawlers and other automated clients'),
});

const breakdown = z.array(z.object({ label: z.string(), clicks: z.number().int() }));

export const analyticsView = z.object({
  code: z.string(),
  range: z.object({ from: z.string(), to: z.string(), interval: z.enum(['hour', 'day']) }),
  totals: z.object({ clicks: z.number().int(), uniqueVisitors: z.number().int() }),
  series: z.array(z.object({ bucket: z.string(), clicks: z.number().int() })),
  breakdowns: z.object({
    countries: breakdown,
    browsers: breakdown,
    operatingSystems: breakdown,
    devices: breakdown,
    referrers: breakdown,
  }),
});
