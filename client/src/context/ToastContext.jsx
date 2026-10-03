import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { TOAST_DISMISS_MS, ToastKind } from '../constants.js';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);
  const dismissTimers = useRef(new Set());

  const showToast = useCallback((message, kind = ToastKind.INFO) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, message, kind }]);

    const timer = setTimeout(() => {
      dismissTimers.current.delete(timer);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, TOAST_DISMISS_MS);
    dismissTimers.current.add(timer);
  }, []);

  useEffect(() => {
    const pendingTimers = dismissTimers.current;
    return () => pendingTimers.forEach(clearTimeout);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div id="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={toast.kind === ToastKind.ERROR ? 'toast error' : 'toast'}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// Returns `showToast(message, kind?)`.
export function useToast() {
  const showToast = useContext(ToastContext);
  if (!showToast) throw new Error('useToast must be used inside <ToastProvider>');
  return showToast;
}
