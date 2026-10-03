import { useCallback, useEffect, useEffectEvent, useReducer, useState } from 'react';
import { AsyncStatus, LINKS_PAGE_SIZE } from '../constants.js';

const Action = Object.freeze({
  LOADED: 'loaded',
  FAILED: 'failed',
  LOADING_MORE: 'loading-more',
  LOADING_MORE_FAILED: 'loading-more-failed',
  APPENDED: 'appended',
  ADDED: 'added',
  REPLACED: 'replaced',
  REMOVED: 'removed',
});

const INITIAL_STATE = { key: null, items: [], nextCursor: null, error: null, loadingMore: false };

function reducer(state, action) {
  switch (action.type) {
    case Action.LOADED:
      return {
        key: action.key,
        items: action.page.items,
        nextCursor: action.page.nextCursor,
        error: null,
        loadingMore: false,
      };
    case Action.FAILED:
      return { ...state, key: action.key, error: action.error, loadingMore: false };
    case Action.LOADING_MORE:
      return { ...state, loadingMore: true };
    case Action.LOADING_MORE_FAILED:
      return { ...state, loadingMore: false };
    case Action.APPENDED:
      // Ignore a page that belongs to a search the user has already moved on from.
      return action.key === state.key
        ? {
            ...state,
            items: [...state.items, ...action.page.items],
            nextCursor: action.page.nextCursor,
            loadingMore: false,
          }
        : state;
    case Action.ADDED:
      return { ...state, items: [action.link, ...state.items] };
    case Action.REPLACED:
      return {
        ...state,
        items: state.items.map((link) => (link.code === action.link.code ? action.link : link)),
      };
    case Action.REMOVED:
      return { ...state, items: state.items.filter((link) => link.code !== action.code) };
    default:
      return state;
  }
}

// The signed-in user's links: the first page, "load more", and local edits that mirror what the
// API did. `enabled` is false while signed out (nothing is fetched); `query` is the search text.
export function useLinks(api, enabled, query) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const [reloadCount, setReloadCount] = useState(0);
  const key = `${query}|${reloadCount}`;

  const loadFirstPage = useEffectEvent((signal) =>
    api.listLinks({ limit: LINKS_PAGE_SIZE, q: query }, { signal }),
  );

  useEffect(() => {
    if (!enabled) return undefined;

    const controller = new AbortController();
    loadFirstPage(controller.signal).then(
      (page) => {
        if (!controller.signal.aborted) dispatch({ type: Action.LOADED, key, page });
      },
      (error) => {
        if (!controller.signal.aborted) dispatch({ type: Action.FAILED, key, error });
      },
    );
    return () => controller.abort();
  }, [key, enabled]);

  const loadMore = useCallback(async () => {
    if (!state.nextCursor || state.loadingMore) return;

    const requestKey = state.key;
    dispatch({ type: Action.LOADING_MORE });
    try {
      const page = await api.listLinks({
        limit: LINKS_PAGE_SIZE,
        cursor: state.nextCursor,
        q: query,
      });
      dispatch({ type: Action.APPENDED, key: requestKey, page });
    } catch (error) {
      dispatch({ type: Action.LOADING_MORE_FAILED });
      throw error;
    }
  }, [api, query, state.key, state.nextCursor, state.loadingMore]);

  const refresh = useCallback(() => setReloadCount((count) => count + 1), []);
  const add = useCallback((link) => dispatch({ type: Action.ADDED, link }), []);
  const replace = useCallback((link) => dispatch({ type: Action.REPLACED, link }), []);
  const remove = useCallback((code) => dispatch({ type: Action.REMOVED, code }), []);

  const hasSettled = enabled && state.key === key;
  let status = AsyncStatus.READY;
  if (!enabled) status = AsyncStatus.IDLE;
  else if (!hasSettled) status = AsyncStatus.LOADING;
  else if (state.error) status = AsyncStatus.ERROR;

  return {
    items: enabled ? state.items : [],
    status,
    error: hasSettled ? state.error : null,
    hasMore: enabled && state.nextCursor !== null,
    loadingMore: state.loadingMore,
    loadMore,
    refresh,
    add,
    replace,
    remove,
  };
}
