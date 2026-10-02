import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAsync } from './useAsync.js';

/** A promise the test resolves by hand, to control the order in which requests finish. */
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('useAsync', () => {
  it('stays idle and does not call load while disabled', () => {
    let calls = 0;
    const { result } = renderHook(() => useAsync(async () => ++calls, 'k', { enabled: false }));

    expect(result.current).toEqual({ status: 'idle', data: null, error: null });
    expect(calls).toBe(0);
  });

  it('goes from loading to ready with the data', async () => {
    const { result } = renderHook(() => useAsync(async () => 'hello', 'k'));

    expect(result.current.status).toBe('loading');
    await waitFor(() =>
      expect(result.current).toEqual({ status: 'ready', data: 'hello', error: null }),
    );
  });

  it('reports failures', async () => {
    const failure = new Error('boom');
    const { result } = renderHook(() =>
      useAsync(async () => {
        throw failure;
      }, 'k'),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeNull();
  });

  it('reloads when the key changes and aborts the request it replaced', async () => {
    const signals = [];
    const { result, rerender } = renderHook(
      ({ id }) =>
        useAsync(async (signal) => {
          signals.push(signal);
          return `data-${id}`;
        }, `key-${id}`),
      { initialProps: { id: 1 } },
    );
    await waitFor(() => expect(result.current.data).toBe('data-1'));

    rerender({ id: 2 });

    expect(result.current.status).toBe('loading'); // the old data is not shown for the new key
    expect(signals[0].aborted).toBe(true);
    await waitFor(() => expect(result.current.data).toBe('data-2'));
  });

  it('ignores a slow response that arrives after a newer request was made', async () => {
    const first = deferred();
    const second = deferred();
    const pending = { 1: first, 2: second };

    const { result, rerender } = renderHook(
      ({ id }) => useAsync(() => pending[id].promise, `key-${id}`),
      { initialProps: { id: 1 } },
    );
    rerender({ id: 2 });

    await act(async () => {
      second.resolve('newer');
      await second.promise;
    });
    await act(async () => {
      first.resolve('older (late)');
      await first.promise;
    });

    expect(result.current).toEqual({ status: 'ready', data: 'newer', error: null });
  });

  it('does not restart the request when only the load function changes', async () => {
    let calls = 0;
    const { rerender } = renderHook(() =>
      useAsync(async () => {
        calls += 1; // a brand-new function every render
        return 'x';
      }, 'same-key'),
    );
    await waitFor(() => expect(calls).toBe(1));

    rerender();
    rerender();

    expect(calls).toBe(1);
  });
});
