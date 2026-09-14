import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { FolderOpen, LogOut, ShieldCheck, UserRound, Users } from 'lucide-react';
import { ArkiveLogo, ArkiveWordmark } from '../components/ArkiveLogo';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/', end: true, label: 'Files', icon: FolderOpen, id: 'nav-files' },
  { to: '/teams', end: false, label: 'Teams', icon: Users, id: 'nav-teams' },
  { to: '/account', end: false, label: 'Account', icon: UserRound, id: 'nav-account' },
] as const;

export function AppShell() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const wide = pathname === '/' || pathname.startsWith('/w/');
  const [menuOpen, setMenuOpen] = useState(false);

  const initial = (user?.display_name || user?.email || '?').trim().charAt(0).toUpperCase();

  const adminLink = user?.is_instance_admin
    ? { to: '/admin', end: false, label: 'Admin', icon: ShieldCheck, id: 'nav-admin' }
    : null;
  const links = adminLink ? [...NAV, adminLink] : [...NAV];

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-4">
        <div
          className={`glass glass-hairline mx-auto flex items-center gap-2 rounded-2xl px-3 py-2 sm:gap-4 sm:px-4 ${
            wide ? 'max-w-[1600px]' : 'max-w-6xl'
          }`}
        >
          <NavLink to="/" className="group flex items-center gap-2.5">
            <motion.span whileHover={{ rotate: -6, scale: 1.06 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}>
              <ArkiveLogo size={34} />
            </motion.span>
            <ArkiveWordmark className="hidden text-xl sm:block" />
          </NavLink>

          <nav className="ml-2 flex items-center gap-0.5 sm:ml-4">
            {links.map(({ to, end, label, icon: Icon, id }) => (
              <NavLink key={to} to={to} end={end} className="relative block">
                {({ isActive }) => (
                  <span
                    className={`relative flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3 ${
                      isActive ? 'text-white' : 'text-arkive-muted hover:text-arkive-text'
                    }`}
                  >
                    {isActive && (
                      <motion.span
                        layoutId={id}
                        className="absolute inset-0 rounded-xl bg-gradient-to-br from-arkive-accent/30 to-arkive-accent2/20 shadow-[0_0_18px_rgba(139,92,246,0.3)] ring-1 ring-white/12"
                        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      />
                    )}
                    <Icon size={15} className="relative shrink-0" />
                    <span className="relative hidden md:inline">{label}</span>
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="relative ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="group flex cursor-pointer items-center gap-2 rounded-full py-1 pr-1 pl-2.5 transition hover:bg-white/6 sm:pr-2.5"
            >
              <span className="hidden max-w-40 truncate text-sm text-arkive-muted transition group-hover:text-arkive-text sm:block">
                {user?.display_name || user?.email}
              </span>
              <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-arkive-accent to-arkive-accent2 p-[1.5px] shadow-[0_0_14px_rgba(139,92,246,0.45)]">
                <span className="flex h-full w-full items-center justify-center rounded-full bg-arkive-surface font-display text-sm font-bold text-arkive-text">
                  {initial}
                </span>
              </span>
            </button>
            <AnimatePresence>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.96 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                    className="glass-strong glass-hairline absolute right-0 z-20 mt-11 w-52 overflow-hidden rounded-2xl p-1.5"
                  >
                    <div className="border-b border-white/6 px-3 py-2.5">
                      <p className="truncate text-sm font-medium text-arkive-text">
                        {user?.display_name || '—'}
                      </p>
                      <p className="truncate text-xs text-arkive-muted">{user?.email}</p>
                    </div>
                    <NavLink
                      to="/account"
                      onClick={() => setMenuOpen(false)}
                      className="mt-1 flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-arkive-muted transition hover:bg-white/6 hover:text-arkive-text"
                    >
                      <UserRound size={15} /> Account settings
                    </NavLink>
                    <button
                      type="button"
                      onClick={() => void logout()}
                      className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-red-300/90 transition hover:bg-red-500/12 hover:text-red-200"
                    >
                      <LogOut size={15} /> Sign out
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
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
