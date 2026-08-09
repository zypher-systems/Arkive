import { NavLink, Outlet } from 'react-router-dom';
import { ArkiveLogo } from '../components/ArkiveLogo';
import { useAuth } from '../lib/auth';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? 'bg-arkive-panel text-arkive-text'
      : 'text-arkive-muted hover:bg-arkive-panel/60 hover:text-arkive-text'
  }`;

export function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-arkive-border/80 bg-arkive-bg/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <ArkiveLogo size={36} />
            <span className="font-display text-xl font-bold tracking-tight">Arkive</span>
          </div>
          <nav className="ml-4 flex items-center gap-1">
            <NavLink to="/" end className={linkClass}>
              Files
            </NavLink>
            <NavLink to="/teams" className={linkClass}>
              Teams
            </NavLink>
            <NavLink to="/account" className={linkClass}>
              Account
            </NavLink>
            {user?.is_instance_admin && (
              <NavLink to="/admin" className={linkClass}>
                Admin
              </NavLink>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-arkive-muted sm:inline">{user?.display_name}</span>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg border border-arkive-border px-3 py-1.5 text-arkive-muted transition hover:border-arkive-amber/50 hover:text-arkive-text"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
