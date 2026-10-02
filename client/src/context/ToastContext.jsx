import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const ToastContext = createContext(null);
const DISMISS_AFTER_MS = 4_500;

/** Shows short-lived notifications. Use `useToast()` to raise one from anywhere below. */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);
  const timers = useRef(new Set());

  const toast = useCallback((message, kind = 'info') => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, message, kind }]);

    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setToasts((current) => current.filter((t) => t.id !== id));
    }, DISMISS_AFTER_MS);
    timers.current.add(timer);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div id="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={t.kind === 'error' ? 'toast error' : 'toast'}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** @returns {(message: string, kind?: 'info' | 'error') => void} */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context.toast;
}
