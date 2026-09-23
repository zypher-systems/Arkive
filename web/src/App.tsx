import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Spinner } from './components/ui/Spinner';
import { ArkiveLogo } from './components/ArkiveLogo';
import { useAuth } from './lib/auth';
import { useInstance } from './lib/instance';
import { useWorkspaces, WorkspacesProvider } from './lib/workspaces';
import { UploadsProvider } from './lib/uploads';
import { useI18n } from './i18n';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { PublicSharePage } from './pages/PublicSharePage';
import { AppShell } from './pages/AppShell';
import { FolderPage } from './pages/browser/FolderPage';
import { SharedPage } from './pages/browser/SharedPage';
import { RecentPage } from './pages/browser/RecentPage';
import { TrashPage } from './pages/browser/TrashPage';
import { SearchPage } from './pages/browser/SearchPage';
import { DrivePage } from './pages/browser/DrivePage';

const TeamsPage = lazy(() => import('./pages/TeamsPage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));

export function FullPageSpinner({ label }: { label?: string }) {
  const { t } = useI18n();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const tm = window.setTimeout(() => setSlow(true), 12000);
    return () => window.clearTimeout(tm);
  }, []);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4" role="status">
      <ArkiveLogo size={36} className="text-primary opacity-90" />
      <Spinner size={18} className="text-faint" />
      <p className="sr-only">{label || t('common.loading')}</p>
      {slow && <p className="max-w-sm px-4 text-center text-sm text-muted">{t('common.slowLoading')}</p>}
    </div>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!user) {
    const next = location.pathname + location.search;
    return <Navigate to={next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login'} replace />;
  }
  return children;
}

function HomeRedirect() {
  const { personal, workspaces, loaded } = useWorkspaces();
  if (!loaded) return <FullPageSpinner />;
  const target = personal || workspaces.find((w) => w.type !== 'mount') || workspaces[0];
  if (!target) return <Navigate to="/teams" replace />;
  return <Navigate to={`/w/${target.id}`} replace />;
}

function PageFallback() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Spinner size={20} className="text-faint" />
    </div>
  );
}

/** Sends a fresh instance (no users yet) to the first-run setup page. */
function SetupGate({ children }: { children: ReactNode }) {
  const { info, loading } = useInstance();
  const { pathname } = useLocation();
  if (loading) return <FullPageSpinner />;
  if (info?.setup_needed && !pathname.startsWith('/setup') && !pathname.startsWith('/s/')) {
    return <Navigate to="/setup" replace />;
  }
  return children;
}

export default function App() {
  return (
    <SetupGate>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/reset" element={<ResetPasswordPage />} />
        <Route path="/s/:token" element={<PublicSharePage />} />
        <Route
          path="/"
          element={
            <Protected>
              <WorkspacesProvider>
                <UploadsProvider>
                  <AppShell />
                </UploadsProvider>
              </WorkspacesProvider>
            </Protected>
          }
        >
          <Route index element={<HomeRedirect />} />
          <Route path="w/:workspaceId" element={<FolderPage />} />
          <Route path="w/:workspaceId/f/:folderId" element={<FolderPage />} />
          <Route path="shared" element={<SharedPage />} />
          <Route path="shared/:workspaceId/:rootId" element={<FolderPage shared />} />
          <Route path="shared/:workspaceId/:rootId/f/:folderId" element={<FolderPage shared />} />
          <Route path="recent" element={<RecentPage />} />
          <Route path="trash" element={<TrashPage />} />
          <Route path="trash/:workspaceId" element={<TrashPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="drive" element={<DrivePage />} />
          <Route path="drive/:parent" element={<DrivePage />} />
          <Route
            path="teams"
            element={
              <Suspense fallback={<PageFallback />}>
                <TeamsPage />
              </Suspense>
            }
          />
          <Route
            path="account/:tab?"
            element={
              <Suspense fallback={<PageFallback />}>
                <AccountPage />
              </Suspense>
            }
          />
          <Route
            path="admin/:tab?"
            element={
              <Suspense fallback={<PageFallback />}>
                <AdminPage />
              </Suspense>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SetupGate>
  );
}
