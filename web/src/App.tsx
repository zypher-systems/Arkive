import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { SpinnerIcon } from './components/icons';
import { useAuth } from './lib/auth';
import { LoginPage } from './pages/LoginPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { AppShell } from './pages/AppShell';
import { BrowserPage } from './pages/BrowserPage';
import { TeamsPage } from './pages/TeamsPage';
import { AccountPage } from './pages/AccountPage';
import { AdminPage } from './pages/AdminPage';
import { PublicSharePage } from './pages/PublicSharePage';

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!loading) return;
    setTimedOut(false);
    const t = window.setTimeout(() => setTimedOut(true), 12000);
    return () => window.clearTimeout(t);
  }, [loading]);
  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <SpinnerIcon size={22} className="animate-spin text-muted" />
        <p className="text-sm text-muted">Loading…</p>
        {timedOut && (
          <p className="max-w-sm px-4 text-center text-xs text-faint">
            Still loading — the API may be unreachable. Check that the server is up and reload.
          </p>
        )}
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset" element={<ResetPasswordPage />} />
      <Route path="/s/:token" element={<PublicSharePage />} />
      <Route
        path="/"
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        <Route index element={<BrowserPage />} />
        <Route path="w/:workspaceId" element={<BrowserPage />} />
        <Route path="w/:workspaceId/f/:folderId" element={<BrowserPage />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
