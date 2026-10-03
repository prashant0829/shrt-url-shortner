import { ANALYTICS_RANGES } from '../constants.js';
import { useAsync } from './useAsync.js';

// Loads the analytics report for one link over a preset time range.
export function useAnalytics(api, code, range, includeBots) {
  return useAsync((signal) => {
    const { interval, ms } = ANALYTICS_RANGES[range];
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
