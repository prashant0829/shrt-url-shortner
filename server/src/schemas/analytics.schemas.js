import { z } from 'zod';
import { AnalyticsInterval } from '../constants.js';

const interval = z.enum(Object.values(AnalyticsInterval));
const isoDateTime = z.iso.datetime({ offset: true });
const breakdown = z.array(z.object({ label: z.string(), clicks: z.number().int() }));

export const analyticsQuery = z.object({
  from: isoDateTime.optional().describe('Start of range (default: 7 days ago)'),
  to: isoDateTime.optional().describe('End of range (default: now)'),
  interval: interval.default(AnalyticsInterval.DAY).describe('Time-series bucket size'),
  includeBots: z.stringbool().default(false).describe('Count crawlers and other automated clients'),
});

export const analyticsView = z.object({
  code: z.string(),
  range: z.object({ from: z.string(), to: z.string(), interval }),
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
