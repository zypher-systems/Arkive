import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, downloadUrl, type Node } from '../../lib/api';
import { sortNodes } from '../../lib/sort';
import { useI18n } from '../../i18n';
import { useWorkspaces } from '../../lib/workspaces';
import { FileList, RowAction } from '../../components/files/FileList';
import { ListSkeleton } from '../../components/files/EmptyFolder';
import { MenuList, type MenuItem } from '../../components/ui/Menu';
import { EmptyState } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { PageHeader } from '../../components/ui/PageHeader';
import { Notice } from '../../components/ui/Notice';
import { ShareDialog } from '../../components/SharePanel';
import { DownloadIcon, FolderOpenIcon, OpenIcon, SearchIcon, ShareIcon } from '../../components/icons';
import { useSelection } from './useSelection';
import { useViewPrefs } from './useViewPrefs';
import { useOpener } from './useOpener';
import { useListHotkeys } from './useListHotkeys';
import { folderHref, nodeHref } from './routes';

export function SearchPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const [draft, setDraft] = useState(q);
  const { workspaces } = useWorkspaces();
  const [results, setResults] = useState<Node[] | null>(null);
  const [error, setError] = useState('');
  const [share, setShare] = useState<Node | null>(null);
  const [menu, setMenu] = useState<{ items: MenuItem[]; point?: { x: number; y: number }; anchor?: HTMLElement } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prefs = useViewPrefs();

  useEffect(() => setDraft(q), [q]);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    setResults(null);
    api
      .searchAll(q.trim(), { signal: ctrl.signal })
      .then(setResults)
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setResults([]);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => ctrl.abort();
  }, [q]);

  const sorted = useMemo(() => sortNodes(results || [], prefs.sort, locale), [results, prefs.sort, locale]);
  const sel = useSelection(sorted.map((n) => n.id));
  const opener = useOpener({ nodes: sorted, canWrite: true });
  const wsName = (id: string) => {
    const w = workspaces.find((x) => x.id === id);
    return w ? (w.type === 'personal' ? t('nav.myFiles') : w.name) : '—';
  };

  const open = (n: Node) => (n.kind === 'folder' ? navigate(nodeHref(n)) : opener.open(n));
  const menuFor = (n: Node, at: { x: number; y: number } | HTMLElement) => {
    const items: MenuItem[] = [
      { id: 'open', label: t('common.open'), icon: <OpenIcon size={15} />, onSelect: () => open(n) },
      { id: 'loc', label: t('search.showInFolder'), icon: <FolderOpenIcon size={15} />, onSelect: () => navigate(`${folderHref(n.workspace_id, n.parent_id)}?focus=${n.id}`) },
      ...(n.kind === 'file' ? [{ id: 'dl', label: t('common.download'), icon: <DownloadIcon size={15} />, href: downloadUrl(n.id) } as MenuItem] : []),
      { id: 'share', label: t('files.share'), icon: <ShareIcon size={15} />, onSelect: () => setShare(n) },
    ];
    setMenu(at instanceof HTMLElement ? { items, anchor: at } : { items, point: at });
  };

  useListHotkeys({ nodes: sorted, selection: sel, handlers: { open }, enabled: !opener.isOpen && !menu && !share });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 lg:px-6">
        <PageHeader
          title={q ? t('search.resultsFor', { query: q }) : t('search.title')}
          subtitle={results ? t('search.count', { count: results.length }) : undefined}
        />
        <form
          className="mb-3 max-w-xl"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setParams(draft.trim() ? { q: draft.trim() } : {});
          }}
        >
          <Input
            icon={<SearchIcon size={16} />}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            type="search"
          />
        </form>
        {error && <Notice kind="error" className="mb-3">{error}</Notice>}
      </div>
      <div ref={scrollRef} className="scroll-slim min-h-0 flex-1 overflow-y-auto px-1.5 pb-24 sm:px-2.5 lg:px-4 lg:pb-8">
        {results === null ? (
          <ListSkeleton />
        ) : (
          <FileList
            nodes={sorted}
            mode="list"
            scrollRef={scrollRef}
            selection={sel}
            selectable={false}
            label={t('search.results')}
            sort={prefs.sort}
            onSort={prefs.toggleSort}
            columns={['location']}
            locationName={(n) => wsName(n.workspace_id)}
            onOpen={open}
            onMenu={menuFor}
            rowActions={(n) =>
              n.kind === 'file' ? (
                <RowAction label={t('files.downloadName', { name: n.name })} href={downloadUrl(n.id)}>
                  <DownloadIcon size={15} />
                </RowAction>
              ) : null
            }
            emptyState={
              <EmptyState
                icon={<SearchIcon size={24} />}
                title={q ? t('search.noResults', { query: q }) : t('search.startTitle')}
                hint={q ? t('search.noResultsHint') : t('search.startHint')}
              />
            }
          />
        )}
      </div>
      {menu && <MenuList items={menu.items} point={menu.point} anchor={menu.anchor} align="end" onClose={() => setMenu(null)} />}
      {share && <ShareDialog node={share} workspaces={workspaces.filter((w) => w.type !== 'mount')} onClose={() => setShare(null)} />}
      {opener.element}
    </div>
  );
}
