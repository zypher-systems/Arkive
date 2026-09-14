import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  Clock,
  Cloud,
  FolderOpen,
  HardDrive,
  Share2,
  Users,
} from 'lucide-react';
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
  id,
  active,
  onClick,
  icon,
  children,
  badge,
}: {
  id: string;
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
      className={`relative flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors duration-200 ${
        active ? 'text-white' : 'text-arkive-muted hover:text-arkive-text'
      }`}
    >
      {active && (
        <motion.span
          layoutId={`sidebar-${id}`}
          className="absolute inset-0 rounded-xl bg-gradient-to-r from-arkive-accent/28 to-arkive-accent2/14 shadow-[0_0_18px_rgba(139,92,246,0.25)] ring-1 ring-white/10"
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        />
      )}
      {active && (
        <span className="absolute inset-y-1.5 -left-px w-[3px] rounded-full bg-gradient-to-b from-arkive-accent to-arkive-accent2 shadow-[0_0_8px_rgba(139,92,246,0.9)]" />
      )}
      <span
        className={`relative shrink-0 transition-colors ${
          active ? 'text-arkive-accent2' : 'opacity-70'
        }`}
      >
        {icon}
      </span>
      <span className="relative min-w-0 flex-1 truncate">{children}</span>
      {badge && (
        <span className="relative rounded-full bg-white/8 px-1.5 py-0.5 text-[10px] font-semibold text-arkive-muted ring-1 ring-white/10">
          {badge}
        </span>
      )}
    </button>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-5 border-b border-white/5 pb-4 last:mb-0 last:border-0 last:pb-0">
      <p className="mb-2 flex items-center gap-1.5 px-2.5 text-[10px] font-bold tracking-[0.14em] text-arkive-muted/80 uppercase">
        <span className="text-arkive-accent2/70">{icon}</span>
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
    <aside className="glass glass-hairline scroll-slim flex w-full shrink-0 flex-col rounded-3xl lg:sticky lg:top-[5.5rem] lg:h-[calc(100vh-8rem)] lg:w-64">
      <div className="flex-1 overflow-y-auto p-3">
        <Section title="Vaults" icon={<HardDrive size={11} />}>
          {personal && (
            <li>
              <NavBtn
                id={personal.id}
                active={active?.kind === 'workspace' && active.id === personal.id}
                onClick={() => onSelectWorkspace(personal.id)}
                icon={<FolderOpen size={16} />}
              >
                {workspaceLabel(personal)}
              </NavBtn>
            </li>
          )}
          {teams.map((w) => (
            <li key={w.id}>
              <NavBtn
                id={w.id}
                active={active?.kind === 'workspace' && active.id === w.id}
                onClick={() => onSelectWorkspace(w.id)}
                icon={<Users size={16} />}
              >
                {workspaceLabel(w)}
              </NavBtn>
            </li>
          ))}
          {!personal && teams.length === 0 && (
            <li className="px-2.5 py-1.5 text-xs text-arkive-muted">No local vaults</li>
          )}
        </Section>

        <Section title="Library" icon={<Share2 size={11} />}>
          <li>
            <NavBtn
              id="shared"
              active={active?.kind === 'shared'}
              onClick={onSelectShared}
              icon={<Share2 size={16} />}
              badge={sharedCount ? String(sharedCount) : undefined}
            >
              Shared with me
            </NavBtn>
          </li>
          <li>
            <NavBtn
              id="recent"
              active={active?.kind === 'recent'}
              onClick={onSelectRecent}
              icon={<Clock size={16} />}
            >
              Recent
            </NavBtn>
          </li>
        </Section>

        <Section title="Connected" icon={<Cloud size={11} />}>
          {mounts.map((w) => (
            <li key={w.id}>
              <NavBtn
                id={w.id}
                active={active?.kind === 'workspace' && active.id === w.id}
                onClick={() => onSelectWorkspace(w.id)}
                icon={<Cloud size={16} />}
              >
                {workspaceLabel(w)}
              </NavBtn>
            </li>
          ))}
          <li>
            <NavBtn
              id="live-drive"
              active={active?.kind === 'live-drive'}
              onClick={onSelectLiveDrive}
              icon={<Cloud size={16} />}
            >
              Google Drive (live)
            </NavBtn>
          </li>
          {mounts.length === 0 && (
            <li className="px-2.5 py-1.5 text-xs text-arkive-muted">Connect clouds in Account</li>
          )}
        </Section>
      </div>

      <div className="relative border-t border-white/6 px-4 py-4">
        <div
          className="pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-arkive-accent/40 to-transparent"
          aria-hidden
        />
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[10px] font-bold tracking-[0.14em] text-arkive-muted/80 uppercase">
            <HardDrive size={11} className="text-arkive-accent2/70" />
            Storage
          </p>
          {pct != null && (
            <span
              className={`text-[10px] font-semibold ${
                pct >= 0.9 ? 'text-red-300' : 'text-arkive-muted'
              }`}
            >
              {Math.round(pct * 100)}%
            </span>
          )}
        </div>
        <p className="mt-1.5 font-display text-lg font-semibold text-arkive-text">
          {formatBytes(totalBytes)}
          {totalQuota != null && totalQuota > 0 && (
            <span className="text-sm font-normal text-arkive-muted">
              {' '}
              / {formatBytes(totalQuota)}
            </span>
          )}
        </p>
        {pct != null && <ProgressBar value={pct} danger={pct >= 0.9} className="mt-2.5" />}
        <p className="mt-2 text-xs text-arkive-muted">
          {totalFiles} file{totalFiles === 1 ? '' : 's'} across your roots
        </p>
      </div>
    </aside>
  );
}
