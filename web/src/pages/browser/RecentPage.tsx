import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type RecentItem } from '../../lib/api';
import { useI18n, type TKey } from '../../i18n';
import { useWorkspaces } from '../../lib/workspaces';
import { FileThumb } from '../../components/files/FileThumb';
import { ListSkeleton } from '../../components/files/EmptyFolder';
import { EmptyState } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { Notice } from '../../components/ui/Notice';
import { ClockIcon } from '../../components/icons';
import { folderHref } from './routes';

const ACTIONS: Record<string, TKey> = {
  'share.created': 'activity.shareCreated',
  'share.deleted': 'activity.shareDeleted',
  'link.created': 'activity.linkCreated',
  'link.deleted': 'activity.linkDeleted',
  'link.downloaded': 'activity.linkDownload',
  'link.upload': 'activity.linkUpload',
};

function dayKey(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function RecentPage() {
  const { t, formatDate, formatModified, formatDateTime } = useI18n();
  const navigate = useNavigate();
  const { workspaces } = useWorkspaces();
  const [items, setItems] = useState<RecentItem[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .recentActivity()
      .then(setItems)
      .catch((e) => {
        setItems([]);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  const groups = useMemo(() => {
    const today = dayKey(new Date());
    const out: { label: string; items: RecentItem[] }[] = [];
    for (const it of items || []) {
      const k = dayKey(new Date(it.created_at));
      const label = k === today ? t('recent.today') : k === today - 86_400_000 ? t('recent.yesterday') : formatDate(it.created_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(it);
      else out.push({ label, items: [it] });
    }
    return out;
  }, [items, t, formatDate]);

  const wsName = (id?: string | null) => {
    const w = workspaces.find((x) => x.id === id);
    return w ? (w.type === 'personal' ? t('nav.myFiles') : w.name) : '';
  };

  return (
    <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 pb-24 lg:px-6 lg:pb-8">
      <PageHeader title={t('nav.recent')} subtitle={t('recent.subtitle')} />
      {error && <Notice kind="error" className="mb-3">{error}</Notice>}
      {items === null ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState icon={<ClockIcon size={24} />} title={t('recent.emptyTitle')} hint={t('recent.emptyHint')} />
      ) : (
        <div className="max-w-4xl space-y-6">
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h2 className="mb-1.5 px-3 text-2xs font-semibold tracking-wider text-faint uppercase">{g.label}</h2>
              <ul className="panel divide-y divide-line overflow-hidden">
                {g.items.map((ev) => {
                  const name = ev.node_name || t('recent.deletedItem');
                  const actionKey = ACTIONS[ev.action];
                  const canOpen = !!ev.workspace_id && !!ev.node_name;
                  return (
                    <li key={ev.id}>
                      <button
                        type="button"
                        disabled={!canOpen}
                        onClick={() => {
                          if (!ev.workspace_id) return;
                          const base = folderHref(ev.workspace_id, ev.parent_id);
                          navigate(ev.node_id ? `${base}?focus=${ev.node_id}` : base);
                        }}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-hover disabled:cursor-default disabled:hover:bg-transparent coarse:py-3.5"
                      >
                        <FileThumb node={{ id: ev.node_id || '', name, kind: name.includes('.') ? 'file' : 'folder', mime: null }} size={34} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-base font-medium text-ink">{name}</span>
                          <span className="block truncate text-sm text-muted">
                            {actionKey ? t(actionKey) : ev.action}
                            {wsName(ev.workspace_id) && ` · ${wsName(ev.workspace_id)}`}
                          </span>
                        </span>
                        <time dateTime={ev.created_at} title={formatDateTime(ev.created_at)} className="shrink-0 text-sm text-muted">
                          {formatModified(ev.created_at)}
                        </time>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
