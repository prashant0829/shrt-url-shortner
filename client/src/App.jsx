import { useState } from 'react';
import { AnalyticsDialog } from './components/AnalyticsDialog.jsx';
import { AuthDialog } from './components/AuthDialog.jsx';
import { Header } from './components/Header.jsx';
import { LinksSection } from './components/LinksSection.jsx';
import { ShortenSection } from './components/ShortenSection.jsx';
import { API_DOCS_PATH, AuthMode } from './constants.js';
import { useAuth } from './context/AuthContext.jsx';
import { LinksProvider } from './context/LinksContext.jsx';

export default function App() {
  const { user, logout } = useAuth();
  const [authMode, setAuthMode] = useState(null); // null keeps the auth dialog closed
  const [analyticsLink, setAnalyticsLink] = useState(null); // null keeps the analytics dialog closed

  return (
    <>
      <Header user={user} onSignIn={() => setAuthMode(AuthMode.LOGIN)} onSignOut={() => logout()} />

      {/* Keyed by user so that signing in or out starts with a clean list and search box. */}
      <LinksProvider key={user?.id ?? 'anonymous'}>
        <main>
          <ShortenSection />
          {user && <LinksSection onOpenAnalytics={setAnalyticsLink} />}
        </main>
      </LinksProvider>

      <footer className="footer muted">
        <a href={API_DOCS_PATH}>API documentation</a>
      </footer>

      <AuthDialog mode={authMode} onModeChange={setAuthMode} onClose={() => setAuthMode(null)} />
      <AnalyticsDialog link={analyticsLink} onClose={() => setAnalyticsLink(null)} />
    </>
  );
}
