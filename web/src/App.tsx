import { Navigate, Route, Routes } from 'react-router-dom';
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
  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <div className="relative h-12 w-12">
          <div className="absolute inset-0 rounded-full border-2 border-arkive-border" />
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-arkive-accent border-r-arkive-accent2" />
        </div>
        <p className="text-sm text-arkive-muted">Opening vault…</p>
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
