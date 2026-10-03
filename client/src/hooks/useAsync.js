import { useEffect, useEffectEvent, useState } from 'react';
import { AsyncStatus } from '../constants.js';

const NO_RESULT = { key: null, data: null, error: null };

// Runs `load(signal)` whenever `key` changes and returns `{ status, data, error }`.
//
// - The result is stored together with its key, so "loading" simply means "the stored result
//   belongs to an older key". No state is set synchronously inside the effect.
// - The previous request is aborted when the key changes or the component unmounts, so a slow,
//   stale response can never overwrite a newer one.
// - `load` may change on every render without restarting the request (it is an effect event).
export function useAsync(load, key, { enabled = true } = {}) {
  const [result, setResult] = useState(NO_RESULT);
  const runLoad = useEffectEvent(load);

  useEffect(() => {
    if (!enabled) return undefined;

    const controller = new AbortController();
    runLoad(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ key, data, error: null });
      },
      (error) => {
        if (!controller.signal.aborted) setResult({ key, data: null, error });
      },
    );
    return () => controller.abort();
  }, [key, enabled]);

  if (!enabled) return { status: AsyncStatus.IDLE, data: null, error: null };
  if (result.key !== key) return { status: AsyncStatus.LOADING, data: null, error: null };
  return result.error
    ? { status: AsyncStatus.ERROR, data: null, error: result.error }
    : { status: AsyncStatus.READY, data: result.data, error: null };
}
