import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from '../components/shell/Sidebar';
import { TopBar, UploadMenu } from '../components/shell/TopBar';
import { MobileNav, NavDrawer } from '../components/shell/MobileNav';
import { UploadPanel } from '../components/shell/UploadPanel';
import { DropOverlay } from '../components/shell/DropOverlay';
import { CommandPalette } from '../components/shell/CommandPalette';
import { ShortcutsDialog } from '../components/shell/ShortcutsDialog';
import { isTypingTarget } from '../lib/hooks';
import { useWorkspaces } from '../lib/workspaces';
import { useUploadEngine, type UploadTarget } from '../lib/uploads';
import { useI18n } from '../i18n';

export function AppShell() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const { personal, refreshUsage } = useWorkspaces();
  const { engine } = useUploadEngine();
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Close the drawer on navigation.
  useEffect(() => setNavOpen(false), [pathname]);

  // Keep the storage meter fresh after uploads.
  useEffect(() => engine.onUploaded(() => void refreshUsage()), [engine, refreshUsage]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
        return;
      }
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === '?') {
        e.preventDefault();
        setHelpOpen(true);
      } else if (e.key === '/') {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fallbackTarget = useMemo<UploadTarget | null>(
    () => (personal ? { workspaceId: personal.id, parentId: null, label: t('nav.myFiles') } : null),
    [personal, t],
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-app">
      <a
        href="#main"
        className="sr-only-focusable fixed top-2 left-2 z-[200] rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-fg"
      >
        {t('shell.skipToContent')}
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        <TopBar
          onOpenNav={() => setNavOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
          onShortcuts={() => setHelpOpen(true)}
          fallbackTarget={fallbackTarget}
        />
        <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] outline-none lg:pb-0">
          <Outlet />
        </main>
      </div>

      <MobileNav />
      <div className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 shadow-lg sm:hidden rounded-full">
        <UploadMenu fallbackTarget={fallbackTarget} compact />
      </div>
      {navOpen && <NavDrawer onClose={() => setNavOpen(false)} />}
      {searchOpen && <CommandPalette onClose={() => setSearchOpen(false)} />}
      {helpOpen && <ShortcutsDialog onClose={() => setHelpOpen(false)} />}
      <UploadPanel />
      <DropOverlay fallbackTarget={fallbackTarget} />
    </div>
  );
}
