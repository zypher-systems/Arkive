import type { FileViewMode } from './types';
import { formatBytes } from '../../lib/api';

type Props = {
  title: string;
  subtitle: string;
  browsing: boolean;
  /** Show List/Details/Tiles even when not fully browsing (e.g. Shared). */
  showViewModes?: boolean;
  viewMode: FileViewMode;
  onViewMode: (m: FileViewMode) => void;
  query: string;
  onQuery: (q: string) => void;
  rootBytes?: number | null;
  rootQuota?: number | null;
  trashCount: number;
  showTrash: boolean;
  onToggleTrash: () => void;
  onNewFolder: () => void;
  onNewFile?: () => void;
  onUpload: () => void;
  hideTrash?: boolean;
};

function ModeBtn({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2 py-1 text-xs font-medium ${
        active
          ? 'bg-arkive-amber/20 text-arkive-amber'
          : 'text-arkive-muted hover:bg-arkive-panel hover:text-arkive-text'
      }`}
    >
      {label}
    </button>
  );
}

export function FileToolbar({
  title,
  subtitle,
  browsing,
  showViewModes,
  viewMode,
  onViewMode,
  query,
  onQuery,
  rootBytes,
  rootQuota,
  trashCount,
  showTrash,
  onToggleTrash,
  onNewFolder,
  onNewFile,
  onUpload,
  hideTrash,
}: Props) {
  const modes = browsing || !!showViewModes;

  return (
    <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-arkive-muted">{subtitle}</p>
        {browsing && rootBytes != null && (
          <p className="mt-1 text-xs text-arkive-muted">
            This root:{' '}
            <span className="text-arkive-text">{formatBytes(rootBytes)}</span>
            {rootQuota != null && rootQuota > 0 && (
              <span> / {formatBytes(rootQuota)}</span>
            )}
          </p>
        )}
      </div>
      {modes && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-arkive-border bg-arkive-surface p-0.5">
            <ModeBtn active={viewMode === 'list'} label="List" onClick={() => onViewMode('list')} />
            <ModeBtn
              active={viewMode === 'details'}
              label="Details"
              onClick={() => onViewMode('details')}
            />
            <ModeBtn
              active={viewMode === 'tiles'}
              label="Tiles"
              onClick={() => onViewMode('tiles')}
            />
          </div>
          {browsing && (
            <>
              <input
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                placeholder="Search files…"
                className="w-40 rounded-lg border border-arkive-border bg-arkive-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-arkive-amber/40 sm:w-52"
              />
              <button
                type="button"
                onClick={onNewFolder}
                className="rounded-lg border border-arkive-border px-3 py-2 text-sm hover:border-arkive-amber/40"
              >
                New folder
              </button>
              {onNewFile && (
                <button
                  type="button"
                  onClick={onNewFile}
                  className="rounded-lg border border-arkive-border px-3 py-2 text-sm hover:border-arkive-amber/40"
                >
                  New file
                </button>
              )}
              <button
                type="button"
                onClick={onUpload}
                className="rounded-lg bg-gradient-to-r from-arkive-orange to-arkive-amber px-3 py-2 text-sm font-semibold text-black"
              >
                Upload
              </button>
              {!hideTrash && (
                <button
                  type="button"
                  onClick={onToggleTrash}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    showTrash
                      ? 'border-arkive-amber/50 text-arkive-amber'
                      : 'border-arkive-border hover:border-arkive-amber/40'
                  }`}
                >
                  Trash{trashCount ? ` (${trashCount})` : ''}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
