import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';

/** Everything the app needs from context, in the right order (auth raises toasts, so toasts wrap it). */
export function AppProviders({ children, fetchFn }) {
  return (
    <ToastProvider>
      <AuthProvider fetchFn={fetchFn}>{children}</AuthProvider>
    </ToastProvider>
  );
}
