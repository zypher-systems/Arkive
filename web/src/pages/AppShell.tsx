import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ArkiveLogo, ArkiveWordmark } from '../components/ArkiveLogo';
import {
  AdminIcon,
  FolderOpenIcon,
  LogoutIcon,
  MoonIcon,
  SunIcon,
  TeamIcon,
  UserIcon,
} from '../components/icons';
import { IconButton } from '../components/ui/Button';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';

const NAV = [
  { to: '/', end: true, label: 'Files', icon: FolderOpenIcon },
  { to: '/teams', end: false, label: 'Teams', icon: TeamIcon },
  { to: '/account', end: false, label: 'Account', icon: UserIcon },
] as const;

export function AppShell() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const wide = pathname === '/' || pathname.startsWith('/w/');
  const [menuOpen, setMenuOpen] = useState(false);

  const initial = (user?.display_name || user?.email || '?').trim().charAt(0).toUpperCase();

  const adminLink = user?.is_instance_admin
    ? { to: '/admin', end: false, label: 'Admin', icon: AdminIcon }
    : null;
  const links = adminLink ? [...NAV, adminLink] : [...NAV];

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-surface">
        <div
          className={`mx-auto flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-4 ${
            wide ? 'max-w-[1600px]' : 'max-w-6xl'
          }`}
        >
          <NavLink to="/" className="flex shrink-0 items-center gap-2.5 text-ink">
            <ArkiveLogo size={28} className="text-primary" />
            <ArkiveWordmark className="hidden text-[17px] sm:block" />
          </NavLink>

          <nav className="ml-2 flex h-full items-stretch gap-0.5 sm:ml-4">
            {links.map(({ to, end, label, icon: Icon }) => (
              <NavLink key={to} to={to} end={end} className="relative flex items-stretch">
                {({ isActive }) => (
                  <span
                    className={`relative flex items-center gap-1.5 px-2.5 text-sm font-medium transition-colors sm:px-3 ${
                      isActive ? 'text-ink' : 'text-muted hover:text-ink'
                    }`}
                  >
                    <Icon size={15} className="shrink-0" />
                    <span className="hidden md:inline">{label}</span>
                    {isActive && (
                      <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" />
                    )}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="relative ml-auto flex items-center gap-1.5">
            <IconButton
              label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
              size="sm"
              onClick={toggle}
            >
              {theme === 'light' ? <MoonIcon size={15} /> : <SunIcon size={15} />}
            </IconButton>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex cursor-pointer items-center gap-2 rounded-md py-1 pr-1 pl-2.5 transition hover:bg-hover sm:pr-2.5"
            >
              <span className="hidden max-w-40 truncate text-sm text-muted sm:block">
                {user?.display_name || user?.email}
              </span>
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-hover text-[13px] font-semibold text-muted">
                {initial}
              </span>
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
                <div className="animate-fade-in absolute right-0 top-11 z-20 w-56 overflow-hidden rounded-md border border-line bg-surface p-1 shadow-md">
                  <div className="border-b border-line px-3 py-2.5">
                    <p className="truncate text-sm font-medium text-ink">
                      {user?.display_name || '—'}
                    </p>
                    <p className="truncate text-xs text-muted">{user?.email}</p>
                  </div>
                  <NavLink
                    to="/account"
                    onClick={() => setMenuOpen(false)}
                    className="mt-1 flex items-center gap-2.5 rounded px-3 py-2 text-sm text-muted transition hover:bg-hover hover:text-ink"
                  >
                    <UserIcon size={15} /> Account settings
                  </NavLink>
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded px-3 py-2 text-sm text-danger transition hover:bg-danger-soft"
                  >
                    <LogoutIcon size={15} /> Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>
      <main
        className={`mx-auto flex w-full flex-1 flex-col px-3 py-5 sm:px-4 sm:py-6 ${
          wide ? 'max-w-[1600px]' : 'max-w-6xl'
        }`}
      >
        <Outlet />
      </main>
    </div>
  );
}
