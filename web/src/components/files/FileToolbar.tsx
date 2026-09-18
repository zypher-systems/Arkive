import {
  CloseIcon,
  DetailsViewIcon,
  FilePlusIcon,
  FolderPlusIcon,
  ListViewIcon,
  SearchIcon,
  TilesViewIcon,
  TrashIcon,
  UploadIcon,
} from '../icons';
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
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>
        {browsing && rootBytes != null && (
          <p className="mt-0.5 text-xs text-muted">
            This root:{' '}
            <span className="font-medium text-ink">{formatBytes(rootBytes)}</span>
            {rootQuota != null && rootQuota > 0 && (
              <span> / {formatBytes(rootQuota)}</span>
            )}
          </p>
        )}
      </div>
      {modes && (
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size="sm"
            value={viewMode}
            onChange={onViewMode}
            items={[
              { value: 'list', icon: <ListViewIcon size={14} />, title: 'List view' },
              { value: 'details', icon: <DetailsViewIcon size={14} />, title: 'Details view' },
              { value: 'tiles', icon: <TilesViewIcon size={14} />, title: 'Tiles view' },
            ]}
          />
          {browsing && (
            <>
              <div className="relative">
                <Input
                  value={query}
                  onChange={(e) => onQuery(e.target.value)}
                  placeholder="Search files…"
                  icon={<SearchIcon size={14} />}
                  className="w-40 sm:w-52"
                />
                {query && (
                  <IconButton
                    label="Clear search"
                    size="xs"
                    onClick={() => onQuery('')}
                    className="absolute top-1/2 right-1.5 -translate-y-1/2"
                  >
                    <CloseIcon size={12} />
                  </IconButton>
                )}
              </div>
              <Button size="sm" variant="secondary" onClick={onNewFolder} icon={<FolderPlusIcon size={14} />}>
                <span className="hidden sm:inline">New folder</span>
              </Button>
              {onNewFile && (
                <Button size="sm" variant="secondary" onClick={onNewFile} icon={<FilePlusIcon size={14} />}>
                  <span className="hidden sm:inline">New file</span>
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={onUpload} icon={<UploadIcon size={14} />}>
                Upload
              </Button>
              {!hideTrash && (
                <Button
                  size="sm"
                  variant={showTrash ? 'primary' : 'secondary'}
                  onClick={onToggleTrash}
                  icon={<TrashIcon size={14} />}
                >
                  <span className="hidden sm:inline">Trash</span>
                  {trashCount > 0 && (
                    <span className="rounded-full bg-hover px-1.5 text-[10px] font-bold text-muted ring-1 ring-line">
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
