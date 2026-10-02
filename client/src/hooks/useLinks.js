import { useCallback, useEffect, useEffectEvent, useReducer, useState } from 'react';

const PAGE_SIZE = 20;
const INITIAL = { key: null, items: [], nextCursor: null, error: null, loadingMore: false };

function reducer(state, action) {
  switch (action.type) {
    case 'loaded':
      return {
        key: action.key,
        items: action.page.items,
        nextCursor: action.page.nextCursor,
        error: null,
        loadingMore: false,
      };
    case 'failed':
      return { ...state, key: action.key, error: action.error, loadingMore: false };
    case 'loading-more':
      return { ...state, loadingMore: true };
    case 'loading-more-failed':
      return { ...state, loadingMore: false };
    case 'appended':
      // Ignore a page that belongs to a search the user has already moved on from.
      return action.key === state.key
        ? {
            ...state,
            items: [...state.items, ...action.page.items],
            nextCursor: action.page.nextCursor,
            loadingMore: false,
          }
        : state;
    case 'added':
      return { ...state, items: [action.link, ...state.items] };
    case 'replaced':
      return {
        ...state,
        items: state.items.map((link) => (link.code === action.link.code ? action.link : link)),
      };
    case 'removed':
      return { ...state, items: state.items.filter((link) => link.code !== action.code) };
    default:
      return state;
  }
}

/**
 * The signed-in user's links: first page, "load more", and local edits that mirror what the API did.
 *
 * @param {ReturnType<typeof import('../api/client.js').createApiClient>} api
 * @param {boolean} enabled False while signed out (the list is then empty and nothing is fetched).
 * @param {string} query The search text to filter by.
 */
export function useLinks(api, enabled, query) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const [version, setVersion] = useState(0);
  const key = `${query}|${version}`;

  const loadFirstPage = useEffectEvent((signal) =>
    api.listLinks({ limit: PAGE_SIZE, q: query }, { signal }),
  );

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    loadFirstPage(controller.signal).then(
      (page) => {
        if (!controller.signal.aborted) dispatch({ type: 'loaded', key, page });
      },
      (error) => {
        if (!controller.signal.aborted) dispatch({ type: 'failed', key, error });
      },
    );
    return () => controller.abort();
  }, [key, enabled]);

  const loadMore = useCallback(async () => {
    if (!state.nextCursor || state.loadingMore) return;
    const requestKey = state.key;
    dispatch({ type: 'loading-more' });
    try {
      const page = await api.listLinks({ limit: PAGE_SIZE, cursor: state.nextCursor, q: query });
      dispatch({ type: 'appended', key: requestKey, page });
    } catch (error) {
      dispatch({ type: 'loading-more-failed' });
      throw error;
    }
  }, [api, query, state.key, state.nextCursor, state.loadingMore]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const add = useCallback((link) => dispatch({ type: 'added', link }), []);
  const replace = useCallback((link) => dispatch({ type: 'replaced', link }), []);
  const remove = useCallback((code) => dispatch({ type: 'removed', code }), []);

  const settled = enabled && state.key === key;
  let status = 'ready';
  if (!enabled) status = 'idle';
  else if (!settled) status = 'loading';
  else if (state.error) status = 'error';

  return {
    items: enabled ? state.items : [],
    status,
    error: settled ? state.error : null,
    hasMore: enabled && state.nextCursor !== null,
    loadingMore: state.loadingMore,
    loadMore,
    refresh,
    add,
    replace,
    remove,
  };
}
