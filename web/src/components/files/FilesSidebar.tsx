import type { ReactNode } from 'react';
import {
  ClockIcon,
  CloudIcon,
  FolderOpenIcon,
  DriveIcon,
  ShareIcon,
  TeamIcon,
} from '../icons';
import type { Workspace } from '../../lib/api';
import { formatBytes } from '../../lib/api';
import { ProgressBar } from '../ui/Card';

export type SidebarView =
  | { kind: 'workspace'; id: string }
  | { kind: 'shared' }
  | { kind: 'recent' }
  | { kind: 'live-drive' };

type Props = {
  personal?: Workspace;
  teams: Workspace[];
  mounts: Workspace[];
  active: SidebarView | null;
  sharedCount: number;
  totalBytes: number;
  totalFiles: number;
  totalQuota?: number | null;
  onSelectWorkspace: (id: string) => void;
  onSelectShared: () => void;
  onSelectRecent: () => void;
  onSelectLiveDrive: () => void;
};

function workspaceLabel(w: Workspace) {
  if (w.type === 'personal') return 'My files';
  if (w.type === 'mount') return w.name || 'Cloud';
  return w.name;
}

function NavBtn({
  active,
  onClick,
  icon,
  children,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors duration-150 ${
        active ? 'bg-hover font-medium text-ink' : 'text-muted hover:bg-hover hover:text-ink'
      }`}
    >
      {active && (
        <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" aria-hidden />
      )}
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {badge && (
        <span className="rounded-full bg-inset px-1.5 py-0.5 text-[10px] font-semibold text-muted ring-1 ring-line">
          {badge}
        </span>
      )}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wide text-faint uppercase">
        {title}
      </p>
      <ul className="space-y-0.5">{children}</ul>
    </section>
  );
}

export function FilesSidebar({
  personal,
  teams,
  mounts,
  active,
  sharedCount,
  totalBytes,
  totalFiles,
  totalQuota,
  onSelectWorkspace,
  onSelectShared,
  onSelectRecent,
  onSelectLiveDrive,
}: Props) {
  const pct = totalQuota != null && totalQuota > 0 ? totalBytes / totalQuota : null;

  return (
    <aside className="scroll-slim flex w-full shrink-0 flex-col lg:sticky lg:top-[4.5rem] lg:h-[calc(100vh-7rem)] lg:w-60 lg:border-r lg:border-line lg:pr-4">
      <nav className="flex-1 overflow-y-auto rounded-md border border-line bg-surface p-2.5 shadow-xs lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
        <Section title="Vaults">
          {personal && (
            <li>
              <NavBtn
                active={active?.kind === 'workspace' && active.id === personal.id}
                onClick={() => onSelectWorkspace(personal.id)}
                icon={<FolderOpenIcon size={15} />}
              >
                {workspaceLabel(personal)}
              </NavBtn>
            </li>
          )}
          {teams.map((w) => (
            <li key={w.id}>
              <NavBtn
                active={active?.kind === 'workspace' && active.id === w.id}
                onClick={() => onSelectWorkspace(w.id)}
                icon={<TeamIcon size={15} />}
              >
                {workspaceLabel(w)}
              </NavBtn>
            </li>
          ))}
          {!personal && teams.length === 0 && (
            <li className="px-2.5 py-1.5 text-xs text-muted">No local vaults</li>
          )}
        </Section>

        <Section title="Library">
          <li>
            <NavBtn
              active={active?.kind === 'shared'}
              onClick={onSelectShared}
              icon={<ShareIcon size={15} />}
              badge={sharedCount ? String(sharedCount) : undefined}
            >
              Shared with me
            </NavBtn>
          </li>
          <li>
            <NavBtn
              active={active?.kind === 'recent'}
              onClick={onSelectRecent}
              icon={<ClockIcon size={15} />}
            >
              Recent
            </NavBtn>
          </li>
        </Section>

        <Section title="Connected">
          {mounts.map((w) => (
            <li key={w.id}>
              <NavBtn
                active={active?.kind === 'workspace' && active.id === w.id}
                onClick={() => onSelectWorkspace(w.id)}
                icon={<CloudIcon size={15} />}
              >
                {workspaceLabel(w)}
              </NavBtn>
            </li>
          ))}
          <li>
            <NavBtn
              active={active?.kind === 'live-drive'}
              onClick={onSelectLiveDrive}
              icon={<CloudIcon size={15} />}
            >
              Google Drive (live)
            </NavBtn>
          </li>
          {mounts.length === 0 && (
            <li className="px-2.5 py-1.5 text-xs text-muted">Connect clouds in Account</li>
          )}
        </Section>
      </nav>

      <div className="mt-4 border-t border-line pt-4 pr-1 pl-1 lg:pl-2.5">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-faint uppercase">
            <DriveIcon size={12} />
            Storage
          </p>
          {pct != null && (
            <span
              className={`text-[11px] font-semibold ${
                pct >= 0.9 ? 'text-danger' : 'text-muted'
              }`}
            >
              {Math.round(pct * 100)}%
            </span>
          )}
        </div>
        <p className="mt-1.5 text-sm font-semibold text-ink">
          {formatBytes(totalBytes)}
          {totalQuota != null && totalQuota > 0 && (
            <span className="font-normal text-muted">
              {' '}
              / {formatBytes(totalQuota)}
            </span>
          )}
        </p>
        {pct != null && <ProgressBar value={pct} danger={pct >= 0.9} className="mt-2" />}
        <p className="mt-1.5 text-xs text-muted">
          {totalFiles} file{totalFiles === 1 ? '' : 's'} across your roots
        </p>
      </div>
    </aside>
  );
}
