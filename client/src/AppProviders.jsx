import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';

// Auth raises toasts, so the toast provider has to wrap it.
export function AppProviders({ children, fetchFn }) {
  return (
    <ToastProvider>
      <AuthProvider fetchFn={fetchFn}>{children}</AuthProvider>
    </ToastProvider>
  );
}
