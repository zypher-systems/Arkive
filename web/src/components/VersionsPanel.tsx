import { useCallback, useEffect, useState } from 'react';
import { api, type Node } from '../lib/api';
import { useConfirm } from '../lib/confirm';
import { useI18n } from '../i18n';
import { useToast } from './Toast';
import { ActivityIcon, DownloadIcon, HistoryIcon, RestoreIcon } from './icons';
import { IconButton } from './ui/Button';
import { EmptyState } from './ui/Card';
import { Notice } from './ui/Notice';
import { Spinner } from './ui/Spinner';

type Version = { version: number; size: number; created_at: string; created_by?: string };
type Activity = { id: string; action: string; actor?: string; created_at: string };

export function VersionsSection({ node, canWrite, onRestored }: { node: Node; canWrite: boolean; onRestored?: () => void }) {
  const { t, formatBytes, formatDateTime, formatRelative } = useI18n();
  const { toast } = useToast();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState('');
  const { ask, dialog } = useConfirm();

  const load = useCallback(async () => {
    setVersions(await api.versions(node.id));
  }, [node.id]);

  useEffect(() => {
    setVersions(null);
    setError('');
    void load().catch((e) => setError(e instanceof Error ? e.message : t('versions.loadFailed')));
  }, [load, t]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!versions)
    return (
      <div className="flex justify-center py-8">
        <Spinner className="text-faint" />
      </div>
    );

  return (
    <div>
      <ol className="relative space-y-1">
        <li className="flex items-center gap-3 rounded-lg bg-accent-soft/60 px-3 py-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-2xs font-bold text-accent-fg">
            {t('versions.currentShort')}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">{t('versions.current')}</p>
            <p className="truncate text-xs text-muted">
              {formatBytes(node.size)} · {formatRelative(node.updated_at)}
            </p>
          </div>
        </li>
        {versions.map((v) => (
          <li key={v.version} className="group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-hover">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-active text-2xs font-semibold text-muted">
              v{v.version}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink" title={formatDateTime(v.created_at)}>
                {formatDateTime(v.created_at)}
              </p>
              <p className="truncate text-xs text-muted">
                {formatBytes(v.size)}
                {v.created_by ? ` · ${v.created_by}` : ''}
              </p>
            </div>
            <a
              href={`/api/nodes/${node.id}/versions/${v.version}/download`}
              aria-label={t('versions.download', { version: v.version })}
              title={t('versions.download', { version: v.version })}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition hover:bg-active hover:text-ink coarse:h-11 coarse:w-11"
            >
              <DownloadIcon size={15} />
            </a>
            {canWrite && (
              <IconButton
                label={t('versions.restore', { version: v.version })}
                size="md"
                onClick={() =>
                  ask({
                    title: t('versions.restoreTitle'),
                    message: t('versions.restoreMessage', { version: v.version }),
                    confirmLabel: t('versions.restoreConfirm'),
                    tone: 'default',
                    run: async () => {
                      try {
                        await api.restoreVersion(node.id, v.version);
                        await load();
                        onRestored?.();
                        toast({ message: t('versions.restored', { version: v.version }) });
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                        throw e;
                      }
                    },
                  })
                }
              >
                <RestoreIcon size={15} />
              </IconButton>
            )}
          </li>
        ))}
      </ol>
      {versions.length === 0 && (
        <EmptyState compact icon={<HistoryIcon size={20} />} title={t('versions.emptyTitle')} hint={t('versions.emptyHint')} />
      )}
      {dialog}
    </div>
  );
}

const ACTION_KEYS: Record<string, Parameters<ReturnType<typeof useI18n>['t']>[0]> = {
  'share.created': 'activity.shareCreated',
  'share.deleted': 'activity.shareDeleted',
  'link.created': 'activity.linkCreated',
  'link.deleted': 'activity.linkDeleted',
  'link.download': 'activity.linkDownload',
  'link.downloaded': 'activity.linkDownload',
  'link.upload': 'activity.linkUpload',
  'link.uploaded': 'activity.linkUpload',
};

export function ActivitySection({ node }: { node: Node }) {
  const { t, formatRelative, formatDateTime } = useI18n();
  const [items, setItems] = useState<Activity[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setItems(null);
    setError('');
    api
      .activity(node.id)
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : t('activity.loadFailed')));
  }, [node.id, t]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!items)
    return (
      <div className="flex justify-center py-8">
        <Spinner className="text-faint" />
      </div>
    );
  if (items.length === 0)
    return <EmptyState compact icon={<ActivityIcon size={20} />} title={t('activity.emptyTitle')} hint={t('activity.emptyHint')} />;

  return (
    <ol className="relative ml-2 border-l border-line">
      {items.map((a) => {
        const key = ACTION_KEYS[a.action];
        return (
          <li key={a.id} className="relative py-2 pl-5">
            <span className="absolute top-3.5 -left-[5px] h-2.5 w-2.5 rounded-full border-2 border-surface bg-strong" aria-hidden />
            <p className="text-sm text-ink">{key ? t(key) : a.action}</p>
            <p className="text-xs text-muted" title={formatDateTime(a.created_at)}>
              {a.actor || t('activity.anonymous')} · {formatRelative(a.created_at)}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
