import { RANGES } from '../lib/ranges.js';
import { useAsync } from './useAsync.js';

/**
 * Loads the analytics report for one link over a preset range.
 * @param {ReturnType<typeof import('../api/client.js').createApiClient>} api
 * @param {string} code
 * @param {keyof typeof RANGES} range
 * @param {boolean} includeBots
 */
export function useAnalytics(api, code, range, includeBots) {
  return useAsync((signal) => {
    const { interval, ms } = RANGES[range];
    const to = new Date();
    return api.getAnalytics(
      code,
      {
        interval,
        from: new Date(to.getTime() - ms).toISOString(),
        to: to.toISOString(),
        includeBots,
      },
      { signal },
    );
  }, `${code}|${range}|${includeBots}`);
}
