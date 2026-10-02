import { createContext, useContext, useMemo, useState } from 'react';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { useLinks } from '../hooks/useLinks.js';
import { useAuth } from './AuthContext.jsx';

const LinksContext = createContext(null);

/**
 * Shares the links list (and its search box) between the creation form and the list.
 * Mount it with `key={user?.id}` so that signing in or out starts from a clean state.
 */
export function LinksProvider({ children }) {
  const { api, user } = useAuth();
  const [searchText, setSearchText] = useState('');
  const query = useDebouncedValue(searchText.trim(), 300);
  const links = useLinks(api, Boolean(user), query);

  const { items, status, error, hasMore, loadingMore, loadMore, refresh, add, replace, remove } =
    links;
  const value = useMemo(
    () => ({
      items,
      status,
      error,
      hasMore,
      loadingMore,
      loadMore,
      refresh,
      add,
      replace,
      remove,
      searchText,
      setSearchText,
      query,
    }),
    [
      items,
      status,
      error,
      hasMore,
      loadingMore,
      loadMore,
      refresh,
      add,
      replace,
      remove,
      searchText,
      query,
    ],
  );

  return <LinksContext.Provider value={value}>{children}</LinksContext.Provider>;
}

export function useLinksContext() {
  const context = useContext(LinksContext);
  if (!context) throw new Error('useLinksContext must be used inside <LinksProvider>');
  return context;
}
