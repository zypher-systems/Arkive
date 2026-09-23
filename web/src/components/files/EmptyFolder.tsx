import type { ReactNode } from 'react';
import { FolderPlusIcon, FolderUploadIcon, UploadIcon } from '../icons';
import { Button } from '../ui/Button';
import { useI18n } from '../../i18n';

/** Friendly empty-folder state with the two actions people actually want. */
export function EmptyFolder({
  canWrite,
  onUpload,
  onUploadFolder,
  onNewFolder,
  title,
  hint,
  icon,
}: {
  canWrite: boolean;
  onUpload?: () => void;
  onUploadFolder?: () => void;
  onNewFolder?: () => void;
  title?: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center sm:py-24">
      <div className="relative mb-5">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-line bg-surface shadow-sm">
          {icon || (
            <svg width="44" height="44" viewBox="0 0 40 40" aria-hidden className="text-folder">
              <path d="M4 11.5A3.5 3.5 0 0 1 7.5 8h8.2c.9 0 1.8.4 2.4 1.1L20.4 12H32.5A3.5 3.5 0 0 1 36 15.5V16H4v-4.5z" fill="currentColor" opacity=".45" />
              <path d="M4 15h32v14.5a3.5 3.5 0 0 1-3.5 3.5h-25A3.5 3.5 0 0 1 4 29.5V15z" fill="currentColor" opacity=".85" />
            </svg>
          )}
        </div>
        {canWrite && (
          <span className="absolute -right-2 -bottom-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-app bg-accent text-accent-fg">
            <UploadIcon size={15} />
          </span>
        )}
      </div>
      <h2 className="text-lg font-semibold tracking-tight text-ink">{title || t('empty.folderTitle')}</h2>
      <p className="mt-1.5 max-w-sm text-base text-muted">
        {hint || (canWrite ? t('empty.folderHint') : t('empty.folderReadOnly'))}
      </p>
      {canWrite && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {onUpload && (
            <Button variant="accent" icon={<UploadIcon size={15} />} onClick={onUpload}>
              {t('upload.files')}
            </Button>
          )}
          {onUploadFolder && (
            <Button variant="secondary" icon={<FolderUploadIcon size={15} />} onClick={onUploadFolder} className="max-sm:hidden">
              {t('upload.folder')}
            </Button>
          )}
          {onNewFolder && (
            <Button variant="secondary" icon={<FolderPlusIcon size={15} />} onClick={onNewFolder}>
              {t('files.newFolder')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-1 px-3 pt-3" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-11 items-center gap-3">
          <div className="skeleton h-7 w-7 shrink-0 rounded-md" />
          <div className="skeleton h-3.5" style={{ width: `${40 - ((i * 7) % 18)}%` }} />
          <div className="skeleton ml-auto hidden h-3 w-20 sm:block" />
          <div className="skeleton hidden h-3 w-14 sm:block" />
        </div>
      ))}
    </div>
  );
}
