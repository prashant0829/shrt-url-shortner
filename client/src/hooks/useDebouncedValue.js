import { useEffect, useState } from 'react';

/** Returns `value` once it has stopped changing for `delayMs` (e.g. to avoid a request per keystroke). */
export function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
