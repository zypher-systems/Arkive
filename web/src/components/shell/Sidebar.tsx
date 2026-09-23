import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ArkiveLogo, ArkiveWordmark } from '../ArkiveLogo';
import {
  ClockIcon,
  CloudIcon,
  FolderOpenIcon,
  PlusIcon,
  ShareIcon,
  TeamIcon,
  TrashIcon,
} from '../icons';
import { CountBadge, ProgressBar } from '../ui/Card';
import { useWorkspaces } from '../../lib/workspaces';
import { useI18n } from '../../i18n';

function NavItem({
  to,
  icon,
  children,
  badge,
  active,
  onNavigate,
}: {
  to: string;
  icon: ReactNode;
  children: ReactNode;
  badge?: ReactNode;
  active?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`group relative flex h-9 items-center gap-3 rounded-lg px-3 text-base transition-colors coarse:h-11 ${
        active ? 'bg-active font-medium text-ink' : 'text-muted hover:bg-hover hover:text-ink'
      }`}
    >
      {active && <span aria-hidden className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full bg-accent" />}
      <span className={`shrink-0 ${active ? 'text-accent' : 'text-faint group-hover:text-muted'}`}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {badge}
    </NavLink>
  );
}

function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-5 mb-1 flex h-6 items-center justify-between px-3">
      <span className="text-2xs font-semibold tracking-wider text-faint uppercase">{children}</span>
      {action}
    </div>
  );
}

export function StorageMeter() {
  const { usage } = useWorkspaces();
  const { t, formatBytes, formatNumber } = useI18n();
  if (!usage) {
    return (
      <div className="space-y-2 px-3" aria-hidden>
        <div className="skeleton h-3 w-24" />
        <div className="skeleton h-1.5 w-full" />
      </div>
    );
  }
  const pct = usage.quota && usage.quota > 0 ? usage.bytes / usage.quota : null;
  const tone = pct == null ? 'accent' : pct >= 0.95 ? 'danger' : pct >= 0.8 ? 'accent' : 'accent';
  return (
    <div className="px-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink">{t('shell.storage')}</span>
        {pct != null && (
          <span className={`text-xs tabular-nums ${pct >= 0.9 ? 'font-semibold text-danger' : 'text-muted'}`}>
            {Math.round(pct * 100)}%
          </span>
        )}
      </div>
      {pct != null && (
        <ProgressBar
          value={pct}
          tone={pct >= 0.9 ? 'danger' : tone}
          className="mt-2"
          label={t('shell.storageUsed')}
        />
      )}
      <p className="mt-2 text-xs text-muted">
        {usage.quota
          ? t('shell.storageOf', { used: formatBytes(usage.bytes), total: formatBytes(usage.quota) })
          : t('shell.storageUsedUnlimited', { used: formatBytes(usage.bytes) })}
      </p>
      <p className="text-xs text-faint">{t('shell.fileCount', { count: usage.files, n: formatNumber(usage.files) })}</p>
    </div>
  );
}

/** Navigation tree shared by the desktop sidebar and the mobile drawer. */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const { personal, teams, mounts, sharedCount, liveDrive } = useWorkspaces();

  const inWs = (id?: string) => !!id && (pathname === `/w/${id}` || pathname.startsWith(`/w/${id}/`));
  const onHome = pathname === '/';

  return (
    <nav aria-label={t('shell.navLabel')} className="flex flex-col">
      <ul className="space-y-0.5">
        <li>
          <NavItem
            to={personal ? `/w/${personal.id}` : '/'}
            icon={<FolderOpenIcon size={17} />}
            active={onHome || inWs(personal?.id)}
            onNavigate={onNavigate}
          >
            {t('nav.myFiles')}
          </NavItem>
        </li>
        <li>
          <NavItem
            to="/shared"
            icon={<ShareIcon size={17} />}
            active={pathname.startsWith('/shared')}
            badge={<CountBadge count={sharedCount} />}
            onNavigate={onNavigate}
          >
            {t('nav.shared')}
          </NavItem>
        </li>
        <li>
          <NavItem to="/recent" icon={<ClockIcon size={17} />} active={pathname.startsWith('/recent')} onNavigate={onNavigate}>
            {t('nav.recent')}
          </NavItem>
        </li>
        <li>
          <NavItem to="/trash" icon={<TrashIcon size={17} />} active={pathname.startsWith('/trash')} onNavigate={onNavigate}>
            {t('nav.trash')}
          </NavItem>
        </li>
      </ul>

      <SectionLabel
        action={
          <NavLink
            to="/teams"
            onClick={onNavigate}
            className="flex h-6 w-6 items-center justify-center rounded-md text-faint transition hover:bg-hover hover:text-ink coarse:h-9 coarse:w-9"
            aria-label={t('nav.manageTeams')}
            title={t('nav.manageTeams')}
          >
            <PlusIcon size={14} />
          </NavLink>
        }
      >
        {t('nav.teams')}
      </SectionLabel>
      <ul className="space-y-0.5">
        {teams.map((w) => (
          <li key={w.id}>
            <NavItem to={`/w/${w.id}`} icon={<TeamIcon size={17} />} active={inWs(w.id)} onNavigate={onNavigate}>
              {w.name}
            </NavItem>
          </li>
        ))}
        {teams.length === 0 && (
          <li>
            <NavItem to="/teams" icon={<TeamIcon size={17} />} active={pathname.startsWith('/teams')} onNavigate={onNavigate}>
              {t('nav.teamsEmpty')}
            </NavItem>
          </li>
        )}
      </ul>

      {(mounts.length > 0 || liveDrive) && (
        <>
          <SectionLabel>{t('nav.connected')}</SectionLabel>
          <ul className="space-y-0.5">
            {mounts.map((w) => (
              <li key={w.id}>
                <NavItem to={`/w/${w.id}`} icon={<CloudIcon size={17} />} active={inWs(w.id)} onNavigate={onNavigate}>
                  {w.name || t('nav.cloud')}
                </NavItem>
              </li>
            ))}
            {liveDrive && (
              <li>
                <NavItem to="/drive" icon={<CloudIcon size={17} />} active={pathname.startsWith('/drive')} onNavigate={onNavigate}>
                  {t('nav.googleDriveLive')}
                </NavItem>
              </li>
            )}
          </ul>
        </>
      )}
    </nav>
  );
}

export function Sidebar() {
  const { t } = useI18n();
  return (
    <aside
      aria-label={t('shell.sidebar')}
      className="hidden w-64 shrink-0 flex-col border-r border-line bg-app lg:flex"
    >
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-5">
        <NavLink to="/" className="flex items-center gap-2.5 rounded-md text-ink" aria-label={t('shell.home')}>
          <ArkiveLogo size={28} className="text-primary" />
          <ArkiveWordmark className="text-[17px]" />
        </NavLink>
      </div>
      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-4">
        <SidebarNav />
      </div>
      <div className="shrink-0 border-t border-line px-3 py-4">
        <StorageMeter />
      </div>
    </aside>
  );
}
