import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, downloadUrl, type Node } from '../../lib/api';
import { sortNodes } from '../../lib/sort';
import { useI18n } from '../../i18n';
import { useWorkspaces } from '../../lib/workspaces';
import { FileList, RowAction } from '../../components/files/FileList';
import { FileGrid } from '../../components/files/FileGrid';
import { ListSkeleton } from '../../components/files/EmptyFolder';
import { ViewSwitcher } from '../../components/files/ViewControls';
import { MenuList, type MenuItem } from '../../components/ui/Menu';
import { Badge, EmptyState } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { Notice } from '../../components/ui/Notice';
import { DownloadIcon, OpenIcon, ShareIcon } from '../../components/icons';
import { useSelection } from './useSelection';
import { useViewPrefs } from './useViewPrefs';
import { useOpener } from './useOpener';
import { useListHotkeys } from './useListHotkeys';
import { sharedHref } from './routes';

export function SharedPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { refreshShared } = useWorkspaces();
  const [nodes, setNodes] = useState<Node[] | null>(null);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<{ items: MenuItem[]; point?: { x: number; y: number }; anchor?: HTMLElement } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prefs = useViewPrefs();

  useEffect(() => {
    api
      .sharedWithMe()
      .then(setNodes)
      .catch((e) => {
        setNodes([]);
        setError(e instanceof Error ? e.message : String(e));
      });
    void refreshShared();
  }, [refreshShared]);

  const sorted = useMemo(() => sortNodes(nodes || [], prefs.sort, locale), [nodes, prefs.sort, locale]);
  const sel = useSelection(sorted.map((n) => n.id));
  const opener = useOpener({ nodes: sorted, canWrite: false });

  const open = (n: Node) => {
    if (n.kind === 'folder') navigate(sharedHref(n.workspace_id, n.id));
    else opener.open(n);
  };
  const menuFor = (n: Node, at: { x: number; y: number } | HTMLElement) => {
    const items: MenuItem[] = [
      { id: 'open', label: t('common.open'), icon: <OpenIcon size={15} />, onSelect: () => open(n) },
      ...(n.kind === 'file'
        ? [{ id: 'dl', label: t('common.download'), icon: <DownloadIcon size={15} />, href: downloadUrl(n.id) } as MenuItem]
        : []),
    ];
    setMenu(at instanceof HTMLElement ? { items, anchor: at } : { items, point: at });
  };

  useListHotkeys({ nodes: sorted, selection: sel, handlers: { open }, enabled: !opener.isOpen && !menu });

  const empty = (
    <EmptyState icon={<ShareIcon size={24} />} title={t('shared.emptyTitle')} hint={t('shared.emptyHint')} />
  );
  const view = prefs.viewMode;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 lg:px-6">
        <PageHeader
          title={t('nav.shared')}
          subtitle={t('shared.subtitle')}
          actions={
            <span className="max-sm:hidden">
              <ViewSwitcher value={view} onChange={prefs.setViewMode} />
            </span>
          }
        />
        {error && <Notice kind="error" className="mb-3">{error}</Notice>}
      </div>
      <div ref={scrollRef} className="scroll-slim min-h-0 flex-1 overflow-y-auto px-1.5 pb-24 sm:px-2.5 lg:px-4 lg:pb-8">
        {nodes === null ? (
          <ListSkeleton />
        ) : view === 'list' || view === 'details' ? (
          <FileList
            nodes={sorted}
            mode={view}
            scrollRef={scrollRef}
            selection={sel}
            selectable={false}
            label={t('nav.shared')}
            sort={prefs.sort}
            onSort={prefs.toggleSort}
            columns={['access', 'type']}
            accessLabel={(n) => (
              <Badge tone={n.permission === 'write' ? 'accent' : 'neutral'}>
                {n.permission === 'write' ? t('share.canEdit') : t('share.canView')}
              </Badge>
            )}
            rowActions={(n) =>
              n.kind === 'file' ? (
                <RowAction label={t('files.downloadName', { name: n.name })} href={downloadUrl(n.id)}>
                  <DownloadIcon size={15} />
                </RowAction>
              ) : null
            }
            onOpen={open}
            onMenu={menuFor}
            emptyState={empty}
          />
        ) : (
          <FileGrid
            nodes={sorted}
            mode={view}
            scrollRef={scrollRef}
            selection={sel}
            selectable={false}
            label={t('nav.shared')}
            onOpen={open}
            onMenu={menuFor}
            emptyState={empty}
          />
        )}
      </div>
      {menu && <MenuList items={menu.items} point={menu.point} anchor={menu.anchor} align="end" onClose={() => setMenu(null)} />}
      {opener.element}
    </div>
  );
}
