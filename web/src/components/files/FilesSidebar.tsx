import type { ReactNode } from 'react';
import type { Workspace } from '../../lib/api';
import { formatBytes } from '../../lib/api';

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
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
        active
          ? 'bg-arkive-amber/15 text-arkive-text'
          : 'text-arkive-muted hover:bg-arkive-panel/70 hover:text-arkive-text'
      }`}
    >
      {active && (
        <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-arkive-amber" />
      )}
      <span className="pl-1">{children}</span>
    </button>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-4 border-b border-arkive-border/70 pb-4 last:mb-0 last:border-0 last:pb-0">
      <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-arkive-muted">
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
  return (
    <aside className="flex w-full shrink-0 flex-col rounded-2xl border border-arkive-border bg-arkive-surface/70 lg:sticky lg:top-20 lg:h-[calc(100vh-7rem)] lg:w-60">
      <div className="flex-1 overflow-y-auto p-3">
        <Section title="Local">
          {personal && (
            <li>
              <NavBtn
                active={active?.kind === 'workspace' && active.id === personal.id}
                onClick={() => onSelectWorkspace(personal.id)}
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
              >
                {workspaceLabel(w)}
              </NavBtn>
            </li>
          ))}
          {!personal && teams.length === 0 && (
            <li className="px-2.5 py-1.5 text-xs text-arkive-muted">No local vaults</li>
          )}
        </Section>

        <Section title="Shared">
          <li>
            <NavBtn active={active?.kind === 'shared'} onClick={onSelectShared}>
              Shared with me{sharedCount ? ` (${sharedCount})` : ''}
            </NavBtn>
          </li>
          <li>
            <NavBtn active={active?.kind === 'recent'} onClick={onSelectRecent}>
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
              >
                {workspaceLabel(w)}
              </NavBtn>
            </li>
          ))}
          <li>
            <NavBtn active={active?.kind === 'live-drive'} onClick={onSelectLiveDrive}>
              Google Drive (live)
            </NavBtn>
          </li>
          {mounts.length === 0 && (
            <li className="px-2.5 py-1.5 text-xs text-arkive-muted">Connect clouds in Account</li>
          )}
        </Section>
      </div>

      <div className="border-t border-arkive-border px-3 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-arkive-muted">
          Storage used
        </p>
        <p className="mt-1 font-display text-lg font-semibold text-arkive-text">
          {formatBytes(totalBytes)}
          {totalQuota != null && totalQuota > 0 && (
            <span className="text-sm font-normal text-arkive-muted">
              {' '}
              / {formatBytes(totalQuota)}
            </span>
          )}
        </p>
        {totalQuota != null && totalQuota > 0 && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-arkive-panel">
            <div
              className={`h-full rounded-full ${
                totalBytes / totalQuota >= 0.9
                  ? 'bg-red-400'
                  : 'bg-gradient-to-r from-arkive-orange to-arkive-amber'
              }`}
              style={{ width: `${Math.min(100, (totalBytes / totalQuota) * 100)}%` }}
            />
          </div>
        )}
        <p className="mt-1 text-xs text-arkive-muted">
          {totalFiles} file{totalFiles === 1 ? '' : 's'} across your roots
        </p>
      </div>
    </aside>
  );
}
