import { useCallback, useEffect, useState, type DragEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type LiveDriveItem } from '../../lib/api';
import { useI18n } from '../../i18n';
import { useToast } from '../../components/Toast';
import { LiveDriveThumb } from '../../components/files/FileThumb';
import { ListSkeleton } from '../../components/files/EmptyFolder';
import { EmptyState } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { Notice } from '../../components/ui/Notice';
import { ArrowLeftIcon, CloudIcon } from '../../components/icons';
import { dragHasFiles } from '../../lib/dropFiles';

const LIVE_DRAG = 'application/x-arkive-live-drive';

/** Live Google Drive browser (files stay in Drive; nothing is copied into Arkive). */
export function DrivePage() {
  const { t, formatBytes, formatModified } = useI18n();
  const { toast } = useToast();
  const { parent = 'root' } = useParams();
  const [items, setItems] = useState<LiveDriveItem[] | null>(null);
  const [error, setError] = useState('');
  const [dropId, setDropId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.liveDriveList(parent === 'root' ? undefined : parent);
      setItems(data.items);
      setError('');
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [parent]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  async function uploadInto(files: FileList, folder: string) {
    try {
      for (const f of Array.from(files)) await api.liveDriveUpload(f, folder);
      toast({ message: t('drive.uploaded', { count: files.length }) });
      await load();
    } catch (e) {
      toast({ tone: 'error', message: e instanceof Error ? e.message : t('drive.uploadFailed') });
    }
  }

  async function drop(e: DragEvent, folder: string) {
    e.preventDefault();
    e.stopPropagation();
    setDropId(null);
    if (dragHasFiles(e.dataTransfer) && e.dataTransfer.files.length) {
      await uploadInto(e.dataTransfer.files, folder);
      return;
    }
    const raw = e.dataTransfer.getData(LIVE_DRAG);
    if (!raw) return;
    try {
      const { id } = JSON.parse(raw) as { id: string };
      if (id && id !== folder) {
        await api.liveDriveMove(id, folder, parent);
        await load();
      }
    } catch (err) {
      toast({ tone: 'error', message: err instanceof Error ? err.message : t('drive.moveFailed') });
    }
  }

  return (
    <div
      className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 pb-24 lg:px-6 lg:pb-8"
      onDragOver={(e) => {
        if (dragHasFiles(e.dataTransfer)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onDrop={(e) => void drop(e, parent)}
    >
      <PageHeader
        icon={<CloudIcon size={18} />}
        title={t('nav.googleDriveLive')}
        subtitle={t('drive.subtitle')}
        actions={
          parent !== 'root' ? (
            <Link to="/drive" className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-base text-muted hover:bg-hover hover:text-ink">
              <ArrowLeftIcon size={15} /> {t('drive.root')}
            </Link>
          ) : undefined
        }
      />
      {error && <Notice kind="error" className="mb-3">{error}</Notice>}
      {items === null ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState icon={<CloudIcon size={24} />} title={t('drive.emptyTitle')} hint={t('drive.emptyHint')} />
      ) : (
        <ul className="panel divide-y divide-line overflow-hidden">
          {items.map((item) => {
            const inner = (
              <>
                <LiveDriveThumb item={item} size={30} />
                <span className="min-w-0 flex-1 truncate text-base font-medium text-ink">{item.name}</span>
                <span className="shrink-0 text-sm text-muted max-sm:hidden">{item.modified ? formatModified(item.modified) : ''}</span>
                <span className="w-20 shrink-0 text-right text-sm text-muted tabular-nums">
                  {item.kind === 'folder' ? '—' : formatBytes(item.size)}
                </span>
              </>
            );
            const cls = `flex items-center gap-3 px-4 py-2.5 transition hover:bg-hover coarse:py-3.5 ${
              dropId === item.id ? 'bg-accent-soft ring-2 ring-accent ring-inset' : ''
            }`;
            return (
              <li
                key={item.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(LIVE_DRAG, JSON.stringify({ id: item.id }));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (item.kind !== 'folder') return;
                  e.preventDefault();
                  e.stopPropagation();
                  setDropId(item.id);
                }}
                onDragLeave={() => setDropId((c) => (c === item.id ? null : c))}
                onDrop={(e) => item.kind === 'folder' && void drop(e, item.id)}
              >
                {item.kind === 'folder' ? (
                  <Link to={`/drive/${encodeURIComponent(item.id)}`} className={cls}>
                    {inner}
                  </Link>
                ) : (
                  <a href={api.liveDriveDownloadUrl(item.id)} className={cls}>
                    {inner}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
