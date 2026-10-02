/** Time ranges offered in the analytics view, and the bucket size each one uses. */
export const RANGES = {
  '24h': { label: '24 hours', interval: 'hour', ms: 24 * 3_600_000 },
  '7d': { label: '7 days', interval: 'day', ms: 7 * 86_400_000 },
  '30d': { label: '30 days', interval: 'day', ms: 30 * 86_400_000 },
};

export const DEFAULT_RANGE = '7d';
