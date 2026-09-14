import {
  FilePlus2,
  FolderPlus,
  LayoutGrid,
  List,
  Rows3,
  Search,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { Button, IconButton } from '../ui/Button';
import { Input } from '../ui/Input';
import { Segmented } from '../ui/Segmented';
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
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          <span className="text-iridescent">{title}</span>
        </h1>
        <p className="mt-1 text-sm text-arkive-muted">{subtitle}</p>
        {browsing && rootBytes != null && (
          <p className="mt-1 text-xs text-arkive-muted">
            This root:{' '}
            <span className="font-medium text-arkive-text">{formatBytes(rootBytes)}</span>
            {rootQuota != null && rootQuota > 0 && (
              <span> / {formatBytes(rootQuota)}</span>
            )}
          </p>
        )}
      </div>
      {modes && (
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            layoutId="file-view-mode"
            size="sm"
            value={viewMode}
            onChange={onViewMode}
            items={[
              { value: 'list', icon: <List size={14} />, title: 'List view' },
              { value: 'details', icon: <Rows3 size={14} />, title: 'Details view' },
              { value: 'tiles', icon: <LayoutGrid size={14} />, title: 'Tiles view' },
            ]}
          />
          {browsing && (
            <>
              <div className="relative">
                <Input
                  value={query}
                  onChange={(e) => onQuery(e.target.value)}
                  placeholder="Search files…"
                  icon={<Search size={14} />}
                  className="w-40 sm:w-52"
                />
                {query && (
                  <IconButton
                    label="Clear search"
                    size="xs"
                    onClick={() => onQuery('')}
                    className="absolute top-1/2 right-2 -translate-y-1/2"
                  >
                    <X size={12} />
                  </IconButton>
                )}
              </div>
              <Button size="sm" variant="glass" onClick={onNewFolder} icon={<FolderPlus size={14} />}>
                <span className="hidden sm:inline">New folder</span>
              </Button>
              {onNewFile && (
                <Button size="sm" variant="glass" onClick={onNewFile} icon={<FilePlus2 size={14} />}>
                  <span className="hidden sm:inline">New file</span>
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={onUpload} icon={<UploadCloud size={14} />} className="font-semibold">
                Upload
              </Button>
              {!hideTrash && (
                <Button
                  size="sm"
                  variant={showTrash ? 'primary' : 'outline'}
                  onClick={onToggleTrash}
                  icon={<Trash2 size={14} />}
                  className={showTrash ? '' : ''}
                >
                  <span className="hidden sm:inline">Trash</span>
                  {trashCount > 0 && (
                    <span
                      className={`rounded-full px-1.5 text-[10px] font-bold ${
                        showTrash ? 'bg-black/25 text-white' : 'bg-white/8 text-arkive-muted'
                      }`}
                    >
                      {trashCount}
                    </span>
                  )}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
