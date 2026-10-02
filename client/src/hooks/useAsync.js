import { useEffect, useEffectEvent, useState } from 'react';

const IDLE = { key: null, data: null, error: null };

/**
 * Runs `load(signal)` whenever `key` changes and reports `{ status, data, error }`.
 *
 * - `key` identifies the request; change it to reload. The result is stored *with* its key, so
 *   "loading" is simply "the stored result belongs to an older key": no state is set
 *   synchronously inside the effect.
 * - The previous request is aborted when the key changes or the component unmounts, so a slow,
 *   stale response can never overwrite a newer one.
 * - `load` may change on every render without restarting the request (it is an effect event).
 *
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} load
 * @param {string} key
 * @param {{enabled?: boolean}} [options]
 * @returns {{status: 'idle' | 'loading' | 'ready' | 'error', data: T | null, error: Error | null}}
 */
export function useAsync(load, key, { enabled = true } = {}) {
  const [result, setResult] = useState(IDLE);
  const run = useEffectEvent(load);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    run(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ key, data, error: null });
      },
      (error) => {
        if (!controller.signal.aborted) setResult({ key, data: null, error });
      },
    );
    return () => controller.abort();
  }, [key, enabled]);

  if (!enabled) return { status: 'idle', data: null, error: null };
  if (result.key !== key) return { status: 'loading', data: null, error: null };
  return result.error
    ? { status: 'error', data: null, error: result.error }
    : { status: 'ready', data: result.data, error: null };
}
