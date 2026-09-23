import { useCallback, useEffect, useState } from 'react';
import { api, isMissingEndpoint, type AuditEntry, type User } from '../../lib/api';
import { useI18n, type TKey } from '../../i18n';
import { lookup, type Dict } from '../../i18n/core';
import { en } from '../../i18n/en';
import { Avatar, EmptyState } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Input';
import { Notice } from '../../components/ui/Notice';
import { Spinner } from '../../components/ui/Spinner';
import { ScrollIcon } from '../../components/icons';
import { errText } from './shared';

const GROUPS = ['auth', 'user', 'backend', 'settings', 'share', 'link'] as const;
const PAGE = 50;

function actionKey(action: string): TKey | null {
  const key = `admin.audit.actions.${action.replace(/\./g, '_')}`;
  return lookup(en as unknown as Dict, key) !== undefined ? (key as TKey) : null;
}

function tone(action: string) {
  if (action.endsWith('failed') || action.endsWith('deleted') || action.endsWith('rejected') || action.endsWith('disabled'))
    return 'bg-danger-soft text-danger';
  if (action.startsWith('auth.')) return 'bg-info-soft text-info';
  return 'bg-inset text-muted';
}

export function AuditTab({ users }: { users: User[] }) {
  const { t, formatRelative, formatDateTime } = useI18n();
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (next: string | null) => {
      try {
        const res = await api.audit({ limit: PAGE, cursor: next, action: action || undefined, actor: actor || undefined });
        setItems((prev) => (next && prev ? [...prev, ...res.items] : res.items));
        setCursor(res.next_cursor);
        setError('');
      } catch (e) {
        if (isMissingEndpoint(e)) setMissing(true);
        else setError(errText(e, t('admin.loadFailed')));
        setItems((prev) => prev ?? []);
      }
    },
    [action, actor, t],
  );

  useEffect(() => {
    setItems(null);
    setCursor(null);
    void load(null);
  }, [load]);

  if (missing) {
    return (
      <div className="panel">
        <EmptyState icon={<ScrollIcon size={22} />} title={t('admin.audit.unsupportedTitle')} hint={t('admin.audit.unsupportedHint')} />
      </div>
    );
  }

  const label = (a: string) => {
    const k = actionKey(a);
    return k ? t(k) : a;
  };
  const target = (e: AuditEntry) =>
    e.target_type ? `${e.target_type}${e.target_id ? ` · ${e.target_id.slice(0, 8)}` : ''}` : '—';

  return (
    <section aria-labelledby="audit-title" className="panel overflow-hidden">
      <div className="flex flex-wrap items-end gap-3 px-5 pt-5 pb-4 sm:px-6">
        <div className="min-w-0 flex-1 basis-60">
          <h2 id="audit-title" className="text-md font-semibold tracking-tight text-ink">
            {t('admin.audit.title')}
          </h2>
          <p className="mt-0.5 text-sm text-muted">{t('admin.audit.description')}</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Select value={action} onChange={(e) => setAction(e.target.value)} aria-label={t('admin.audit.action')} className="flex-1 sm:!w-52">
            <option value="">{t('admin.audit.allActions')}</option>
            {GROUPS.map((g) => (
              <option key={g} value={`${g}.`}>
                {t(`admin.audit.groups.${g}`)}
              </option>
            ))}
          </Select>
          <Select value={actor} onChange={(e) => setActor(e.target.value)} aria-label={t('admin.audit.actor')} className="flex-1 sm:!w-52">
            <option value="">{t('admin.audit.allActors')}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error && <Notice kind="error" className="mx-5 mb-4 sm:mx-6">{error}</Notice>}

      {items === null ? (
        <div className="flex justify-center border-t border-line py-12">
          <Spinner size={20} className="text-faint" />
        </div>
      ) : items.length === 0 ? (
        <div className="border-t border-line">
          <EmptyState compact icon={<ScrollIcon size={20} />} title={t('admin.audit.emptyTitle')} hint={t('admin.audit.emptyHint')} />
        </div>
      ) : (
        <>
          <table className="hidden w-full text-left md:table">
            <thead>
              <tr className="border-y border-line bg-inset/60 text-xs text-muted">
                <th scope="col" className="py-2 pr-3 pl-6 font-medium">{t('admin.audit.col.time')}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t('admin.audit.col.actor')}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t('admin.audit.col.action')}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t('admin.audit.col.target')}</th>
                <th scope="col" className="py-2 pr-6 pl-3 font-medium">{t('admin.audit.col.ip')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((e) => (
                <tr key={e.id} className="align-middle transition-colors hover:bg-hover/60">
                  <td className="py-2.5 pr-3 pl-6 text-sm whitespace-nowrap text-muted">
                    <time dateTime={e.created_at} title={formatDateTime(e.created_at)}>
                      {formatRelative(e.created_at)}
                    </time>
                  </td>
                  <td className="max-w-56 px-3 py-2.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <Avatar name={e.actor_email || '?'} size={24} />
                      <span className="truncate text-sm text-ink">{e.actor_email || t('admin.audit.system')}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-ink">{label(e.action)}</span>
                      <code className={`rounded px-1.5 py-px font-mono text-2xs ${tone(e.action)}`}>{e.action}</code>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted">{target(e)}</td>
                  <td className="py-2.5 pr-6 pl-3 font-mono text-xs text-muted">{e.ip || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="divide-y divide-line border-t border-line md:hidden">
            {items.map((e) => (
              <li key={e.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-base font-medium text-ink">{label(e.action)}</span>
                  <time dateTime={e.created_at} title={formatDateTime(e.created_at)} className="shrink-0 text-xs text-muted">
                    {formatRelative(e.created_at)}
                  </time>
                </div>
                <p className="mt-0.5 truncate text-sm text-muted">{e.actor_email || t('admin.audit.system')}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <code className={`rounded px-1.5 py-px font-mono text-2xs ${tone(e.action)}`}>{e.action}</code>
                  {e.target_type && <span className="font-mono text-xs text-faint">{target(e)}</span>}
                  {e.ip && <span className="font-mono text-xs text-faint">{e.ip}</span>}
                </div>
              </li>
            ))}
          </ul>

          {cursor && (
            <div className="flex justify-center border-t border-line px-4 py-3">
              <Button
                variant="secondary"
                size="sm"
                loading={loadingMore}
                onClick={async () => {
                  setLoadingMore(true);
                  await load(cursor);
                  setLoadingMore(false);
                }}
              >
                {t('admin.audit.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
