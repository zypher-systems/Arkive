import { NavLink, useLocation } from 'react-router-dom';
import { ClockIcon, FolderOpenIcon, ShareIcon, TrashIcon } from '../icons';
import { useWorkspaces } from '../../lib/workspaces';
import { useI18n } from '../../i18n';
import { ArkiveLogo, ArkiveWordmark } from '../ArkiveLogo';
import { CloseIcon } from '../icons';
import { IconButton } from '../ui/Button';
import { Drawer } from '../ui/Modal';
import { SidebarNav, StorageMeter } from './Sidebar';

/** Bottom tab bar for phones/tablets (< lg). */
export function MobileNav() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const { personal } = useWorkspaces();
  const filesActive = pathname === '/' || (!!personal && pathname.startsWith(`/w/${personal.id}`));
  const tabs = [
    { to: personal ? `/w/${personal.id}` : '/', label: t('nav.files'), icon: FolderOpenIcon, active: filesActive },
    { to: '/recent', label: t('nav.recent'), icon: ClockIcon, active: pathname.startsWith('/recent') },
    { to: '/shared', label: t('nav.sharedShort'), icon: ShareIcon, active: pathname.startsWith('/shared') },
    { to: '/trash', label: t('nav.trash'), icon: TrashIcon, active: pathname.startsWith('/trash') },
  ];
  return (
    <nav
      aria-label={t('shell.mobileNav')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-4">
        {tabs.map(({ to, label, icon: Icon, active }) => (
          <li key={label}>
            <NavLink
              to={to}
              aria-current={active ? 'page' : undefined}
              className={`flex h-14 flex-col items-center justify-center gap-0.5 text-2xs font-medium transition-colors ${
                active ? 'text-accent-strong' : 'text-muted hover:text-ink'
              }`}
            >
              <Icon size={20} />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function NavDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Drawer side="left" label={t('shell.navLabel')} onClose={onClose}>
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
        <span className="flex items-center gap-2.5 text-ink">
          <ArkiveLogo size={26} className="text-primary" />
          <ArkiveWordmark className="text-[17px]" />
        </span>
        <IconButton label={t('common.close')} onClick={onClose}>
          <CloseIcon size={17} />
        </IconButton>
      </div>
      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <SidebarNav onNavigate={onClose} />
      </div>
      <div className="shrink-0 border-t border-line py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <StorageMeter />
      </div>
    </Drawer>
  );
}
