import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  AdminIcon,
  ArrowLeftIcon,
  ClockIcon,
  FolderOpenIcon,
  SearchIcon,
  ShareIcon,
  TeamIcon,
  TrashIcon,
  UserIcon,
} from '../icons';
import { Kbd } from '../ui/Card';
import { Spinner } from '../ui/Spinner';
import { FileThumb } from '../files/FileThumb';
import { api, type Node } from '../../lib/api';
import { useFocusTrap, useEscape } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';
import { useWorkspaces } from '../../lib/workspaces';
import { useI18n } from '../../i18n';
import { nodeHref } from '../../pages/browser/routes';

type Entry = {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
  group: 'nav' | 'files';
};

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { t, formatModified } = useI18n();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { personal, workspaces } = useWorkspaces();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Node[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  useFocusTrap(ref);
  useEscape(onClose);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const tm = window.setTimeout(() => {
      api
        .searchAll(q, { signal: ctrl.signal })
        .then((r) => setResults(r.slice(0, 30)))
        .catch(() => undefined)
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(tm);
      ctrl.abort();
    };
  }, [query]);

  const wsName = (id: string) => {
    const w = workspaces.find((x) => x.id === id);
    if (!w) return '';
    return w.type === 'personal' ? t('nav.myFiles') : w.name;
  };

  const entries = useMemo<Entry[]>(() => {
    const go = (to: string) => () => {
      onClose();
      navigate(to);
    };
    const nav: Entry[] = [
      { id: 'n-files', label: t('nav.myFiles'), icon: <FolderOpenIcon size={16} />, run: go(personal ? `/w/${personal.id}` : '/'), group: 'nav' },
      { id: 'n-shared', label: t('nav.shared'), icon: <ShareIcon size={16} />, run: go('/shared'), group: 'nav' },
      { id: 'n-recent', label: t('nav.recent'), icon: <ClockIcon size={16} />, run: go('/recent'), group: 'nav' },
      { id: 'n-trash', label: t('nav.trash'), icon: <TrashIcon size={16} />, run: go('/trash'), group: 'nav' },
      { id: 'n-teams', label: t('nav.teams'), icon: <TeamIcon size={16} />, run: go('/teams'), group: 'nav' },
      { id: 'n-account', label: t('nav.account'), icon: <UserIcon size={16} />, run: go('/account'), group: 'nav' },
      ...(user?.is_instance_admin
        ? [{ id: 'n-admin', label: t('nav.admin'), icon: <AdminIcon size={16} />, run: go('/admin'), group: 'nav' as const }]
        : []),
    ];
    const q = query.trim().toLowerCase();
    const navHits = q ? nav.filter((n) => n.label.toLowerCase().includes(q)) : nav;
    const files: Entry[] = results.map((n) => ({
      id: `f-${n.id}`,
      label: n.name,
      hint: [wsName(n.workspace_id), formatModified(n.updated_at)].filter(Boolean).join(' · '),
      icon: <FileThumb node={n} size={28} />,
      run: go(nodeHref(n)),
      group: 'files',
    }));
    const all = [...files, ...navHits];
    if (q) {
      all.push({
        id: 'all',
        label: t('search.allResults', { query: query.trim() }),
        icon: <SearchIcon size={16} />,
        run: go(`/search?q=${encodeURIComponent(query.trim())}`),
        group: 'nav',
      });
    }
    return all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, query, personal, user, t]);

  useEffect(() => setActive(0), [query, results]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(entries.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      entries[active]?.run();
    }
  }

  const fileEntries = entries.filter((e) => e.group === 'files');
  const navEntries = entries.filter((e) => e.group === 'nav');

  const renderGroup = (title: string, list: Entry[], offset: number) =>
    list.length > 0 && (
      <li role="presentation">
        <p className="px-4 pt-3 pb-1.5 text-2xs font-semibold tracking-wider text-faint uppercase">{title}</p>
        <ul role="group" aria-label={title}>
          {list.map((e, i) => {
            const idx = offset + i;
            const on = idx === active;
            return (
              <li
                key={e.id}
                id={`${listId}-${idx}`}
                data-idx={idx}
                role="option"
                aria-selected={on}
                onMouseMove={() => setActive(idx)}
                onClick={() => e.run()}
                className={`mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 coarse:py-3 ${on ? 'bg-hover' : ''}`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center text-muted">{e.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base text-ink">{e.label}</span>
                  {e.hint && <span className="block truncate text-xs text-muted">{e.hint}</span>}
                </span>
                {on && <span className="hidden text-xs text-faint sm:block">↵</span>}
              </li>
            );
          })}
        </ul>
      </li>
    );

  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-[110] flex items-start justify-center bg-overlay p-0 sm:p-4 sm:pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={t('search.dialog')}
        className="animate-pop flex h-dvh w-full flex-col overflow-hidden border-line bg-raised shadow-lg sm:h-auto sm:max-h-[70vh] sm:max-w-xl sm:rounded-xl sm:border"
      >
        <div className="flex items-center gap-2 border-b border-line px-3 sm:px-4">
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-muted sm:hidden"
          >
            <ArrowLeftIcon size={18} />
          </button>
          <SearchIcon size={18} className="hidden shrink-0 text-faint sm:block" />
          <input
            data-autofocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('search.placeholder')}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={entries.length ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            className="h-14 min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-faint"
          />
          {loading ? <Spinner size={16} className="text-faint" /> : <span className="hidden sm:block"><Kbd>Esc</Kbd></span>}
        </div>
        <ul ref={listRef} id={listId} role="listbox" aria-label={t('search.results')} className="scroll-slim min-h-0 flex-1 overflow-y-auto pb-2">
          {query.trim() && !loading && fileEntries.length === 0 && (
            <li role="presentation" className="px-4 py-6 text-center text-sm text-muted">
              {t('search.noResults', { query: query.trim() })}
            </li>
          )}
          {renderGroup(t('search.files'), fileEntries, 0)}
          {renderGroup(query.trim() ? t('search.more') : t('search.jumpTo'), navEntries, fileEntries.length)}
        </ul>
        <div className="hidden items-center gap-4 border-t border-line bg-inset/60 px-4 py-2 text-xs text-muted sm:flex">
          <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> {t('search.navigate')}</span>
          <span className="flex items-center gap-1.5"><Kbd>↵</Kbd> {t('search.openItem')}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
