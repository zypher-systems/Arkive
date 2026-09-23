import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type Node, type WorkspaceMember } from '../../lib/api';
import { canWriteFiles } from '../../lib/access';
import { sortNodes, type SortSpec } from '../../lib/sort';
import { useWorkspaces } from '../../lib/workspaces';
import { useUploadEngine } from '../../lib/uploads';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../i18n';
import { Breadcrumbs, type Crumb } from '../../components/files/Breadcrumbs';
import { FileList, RowAction } from '../../components/files/FileList';
import { FileGrid } from '../../components/files/FileGrid';
import { SelectionBar, type BarAction } from '../../components/files/SelectionBar';
import { DetailsPanel, type DetailsTab } from '../../components/files/DetailsPanel';
import { EmptyFolder, ListSkeleton } from '../../components/files/EmptyFolder';
import { DetailsToggle, SortMenu, ViewSwitcher } from '../../components/files/ViewControls';
import { MenuList, type MenuItem } from '../../components/ui/Menu';
import { Button } from '../../components/ui/Button';
import { Badge, EmptyState } from '../../components/ui/Card';
import { useFilePickers } from '../../components/shell/TopBar';
import { isImageNode, type FileViewMode } from '../../components/files/types';
import {
  AlertIcon,
  ArchiveIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FilePlusIcon,
  FolderMoveIcon,
  FolderPlusIcon,
  FolderUploadIcon,
  GalleryIcon,
  ListViewIcon,
  PasteIcon,
  TilesViewIcon,
  PencilIcon,
  ShareIcon,
  TrashIcon,
  UploadIcon,
} from '../../components/icons';
import { useFolder } from './useFolder';
import { useSelection } from './useSelection';
import { useViewPrefs } from './useViewPrefs';
import { useOpener } from './useOpener';
import { useFileOps } from './useFileOps';
import { useFileDnD } from './useFileDnD';
import { useListHotkeys } from './useListHotkeys';
import { nodeMenuItems, type NodeMenuHandlers } from './nodeMenu';
import { folderHref, sharedHref } from './routes';
import { downloadUrl } from '../../lib/api';

type MenuState = { items: MenuItem[]; point?: { x: number; y: number }; anchor?: HTMLElement } | null;

function useSharedRoot(rootId?: string) {
  const [root, setRoot] = useState<Node | null | undefined>(undefined);
  useEffect(() => {
    if (!rootId) {
      setRoot(undefined);
      return;
    }
    let cancelled = false;
    api
      .sharedWithMe()
      .then((list) => !cancelled && setRoot(list.find((n) => n.id === rootId) ?? null))
      .catch(() => !cancelled && setRoot(null));
    return () => {
      cancelled = true;
    };
  }, [rootId]);
  return root;
}

function useMembers(workspaceId?: string, isTeam?: boolean) {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  useEffect(() => {
    if (!workspaceId || !isTeam) {
      setMembers([]);
      return;
    }
    api.members(workspaceId).then(setMembers).catch(() => setMembers([]));
  }, [workspaceId, isTeam]);
  return members;
}

/** Workspace folders (/w/…) and folders shared with me (/shared/…). */
export function FolderPage({ shared = false }: { shared?: boolean }) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { workspaceId, folderId, rootId } = useParams();
  const [params, setParams] = useSearchParams();
  const { workspaces, loaded: wsLoaded } = useWorkspaces();
  const { engine, setActiveFolder } = useUploadEngine();
  const { inputs: pickerInputs, pickFiles, pickFolder } = useFilePickers();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [detailsTab, setDetailsTab] = useState<DetailsTab>('info');
  const [detailsNodeId, setDetailsNodeId] = useState<string | null>(null);
  const [gridCols, setGridCols] = useState(1);
  const [galleryHintHidden, setGalleryHintHidden] = useState(false);
  const prefs = useViewPrefs();

  const ws = workspaces.find((w) => w.id === workspaceId);
  const listParent = shared ? (folderId ?? rootId ?? null) : (folderId ?? null);
  const folder = useFolder(workspaceId, listParent);
  const sharedRoot = useSharedRoot(shared ? rootId : undefined);
  const members = useMembers(workspaceId, ws?.type === 'team');

  const canWrite = shared
    ? sharedRoot?.permission === 'write'
    : !!ws && canWriteFiles({ workspaceRole: ws.role });
  const canShare = !shared;

  const sorted = useMemo(() => sortNodes(folder.nodes, prefs.sort, locale), [folder.nodes, prefs.sort, locale]);
  const ids = useMemo(() => sorted.map((n) => n.id), [sorted]);
  const sel = useSelection(ids);
  const selectedNodes = useMemo(() => sorted.filter((n) => sel.selected.has(n.id)), [sorted, sel.selected]);

  // Drop stale selection after reloads.
  useEffect(() => {
    sel.prune(new Set(ids));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  // Clear selection when navigating to another folder.
  useEffect(() => {
    sel.clear();
    setDetailsNodeId(null);
    setGalleryHintHidden(false);
    scrollRef.current?.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, listParent]);

  const rootLabel = shared ? t('nav.shared') : ws?.type === 'personal' ? t('nav.myFiles') : ws?.name || t('nav.myFiles');

  const crumbs: Crumb[] = useMemo(() => {
    if (!workspaceId) return [];
    if (shared && rootId) {
      const idx = folder.breadcrumbs.findIndex((b) => b.id === rootId);
      const trail = idx >= 0 ? folder.breadcrumbs.slice(idx) : sharedRoot ? [{ id: rootId, name: sharedRoot.name }] : [];
      return [
        { id: null, name: rootLabel, to: '/shared' },
        ...trail.map((b) => ({ id: b.id, name: b.name, to: sharedHref(workspaceId, rootId, b.id) })),
      ];
    }
    return [
      { id: null, name: rootLabel, to: folderHref(workspaceId) },
      ...folder.breadcrumbs.map((b) => ({ id: b.id, name: b.name, to: folderHref(workspaceId, b.id) })),
    ];
  }, [workspaceId, shared, rootId, folder.breadcrumbs, sharedRoot, rootLabel]);
  const folderName = crumbs[crumbs.length - 1]?.name || rootLabel;

  const updateNode = useCallback(
    (u: Node) => folder.setNodes((prev) => prev.map((n) => (n.id === u.id ? { ...n, ...u } : n))),
    [folder],
  );

  const opener = useOpener({
    nodes: sorted,
    canWrite,
    onSaved: updateNode,
    onInfo: (n) => showDetails(n, 'info'),
  });

  const ops = useFileOps({
    workspaceId,
    parentId: listParent,
    nodes: sorted,
    workspaces,
    reload: folder.reload,
    onFileCreated: (n) => {
      opener.open(n, { edit: true });
    },
  });

  const openNode = useCallback(
    (n: Node) => {
      if (n.kind === 'folder') {
        navigate(shared && rootId ? sharedHref(workspaceId!, rootId, n.id) : folderHref(workspaceId!, n.id));
        return;
      }
      opener.open(n);
    },
    [navigate, shared, rootId, workspaceId, opener],
  );

  function showDetails(n: Node | null, tab: DetailsTab = 'info') {
    if (n) {
      setDetailsNodeId(n.id);
      if (!sel.selected.has(n.id)) sel.select(n.id);
    }
    setDetailsTab(tab);
    prefs.setDetailsOpen(true);
  }

  // Register this folder as the upload / drop target for the shell.
  useEffect(() => {
    if (!workspaceId) return;
    setActiveFolder({
      target: { workspaceId, parentId: listParent, label: folderName },
      readOnly: !canWrite,
      newFolder: canWrite ? ops.newFolder : undefined,
      newFile: canWrite ? ops.newFile : undefined,
    });
  }, [workspaceId, listParent, folderName, canWrite, ops.newFolder, ops.newFile, setActiveFolder]);
  useEffect(() => () => setActiveFolder(null), [setActiveFolder]);

  // Refresh when uploads land here.
  useEffect(() => {
    let timer: number | null = null;
    const off = engine.onUploaded((e) => {
      if (e.workspaceId !== workspaceId || (e.parentId || null) !== listParent) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void folder.reload(true), 250);
    });
    return () => {
      off();
      if (timer) window.clearTimeout(timer);
    };
  }, [engine, workspaceId, listParent, folder]);

  // ?focus=<id> (from search) selects the item and opens it.
  const focusId = params.get('focus');
  useEffect(() => {
    if (!focusId || folder.loading) return;
    const n = sorted.find((x) => x.id === focusId);
    const next = new URLSearchParams(params);
    next.delete('focus');
    setParams(next, { replace: true });
    if (!n) return;
    sel.select(n.id);
    if (n.kind === 'file') opener.open(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, folder.loading, sorted]);

  const dnd = useFileDnD({
    enabled: canWrite,
    selected: sel.selected,
    workspaceId,
    engine,
    moveInto: ops.moveInto,
    labelFor: (count, first) => (count > 1 ? t('files.dragMany', { count }) : first),
  });

  const handlers: NodeMenuHandlers = {
    open: openNode,
    edit: canWrite ? (n) => opener.open(n, { edit: true }) : undefined,
    details: (n, tab) => showDetails(n, tab),
    share: canShare ? (n) => showDetails(n, 'sharing') : undefined,
    rename: canWrite ? ops.rename : undefined,
    moveTo: canWrite ? ops.moveTo : undefined,
    copyTo: ops.copyTo,
    copy: ops.copyToClipboard,
    download: (ns) => void ops.download(ns),
    trash: canWrite ? (ns) => ops.trash(ns) : undefined,
  };

  const openMenu = (n: Node, at: { x: number; y: number } | HTMLElement) => {
    const selection = sel.selected.has(n.id) ? selectedNodes : [n];
    const items = nodeMenuItems(n, selection, handlers, t);
    setMenu(at instanceof HTMLElement ? { items, anchor: at } : { items, point: at });
  };

  const paneMenu = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-file-row], button, a, input')) return;
    e.preventDefault();
    sel.clear();
    const target = { workspaceId: workspaceId!, parentId: listParent, label: folderName };
    const items: MenuItem[] = canWrite
      ? [
          { id: 'mkdir', label: t('files.newFolder'), icon: <FolderPlusIcon size={15} />, shortcut: '⇧N', onSelect: ops.newFolder },
          { id: 'txt', label: t('files.newTextFile'), icon: <FilePlusIcon size={15} />, onSelect: () => ops.newFile('.txt') },
          { id: 'md', label: t('files.newMarkdownFile'), icon: <FilePlusIcon size={15} />, onSelect: () => ops.newFile('.md') },
          { kind: 'separator', id: 's' },
          { id: 'up', label: t('upload.files'), icon: <UploadIcon size={15} />, onSelect: () => pickFiles(target) },
          { id: 'upd', label: t('upload.folder'), icon: <FolderUploadIcon size={15} />, onSelect: () => pickFolder(target) },
          ...(ops.canPaste
            ? [{ kind: 'separator', id: 's2' } as MenuItem, { id: 'paste', label: t('files.paste'), icon: <PasteIcon size={15} />, onSelect: () => void ops.paste() }]
            : []),
        ]
      : [{ kind: 'label', id: 'ro', label: t('files.readOnly') }];
    setMenu({ items, point: { x: e.clientX, y: e.clientY } });
  };

  const detailsOpen = prefs.detailsOpen;
  useListHotkeys({
    nodes: sorted,
    selection: sel,
    columns: prefs.viewMode === 'tiles' || prefs.viewMode === 'gallery' ? gridCols : 1,
    enabled: !ops.dialogOpen && !opener.isOpen && !menu,
    handlers: {
      open: openNode,
      menu: (n) => {
        const el = document.getElementById(`row-${n.id}`);
        const r = el?.getBoundingClientRect();
        openMenu(n, r ? { x: r.left + 48, y: r.bottom - 4 } : { x: 200, y: 200 });
      },
      rename: canWrite ? ops.rename : undefined,
      trash: canWrite ? (ns) => ops.trash(ns) : undefined,
      copy: ops.copyToClipboard,
      paste: canWrite && ops.canPaste ? () => void ops.paste() : undefined,
      newFolder: canWrite ? ops.newFolder : undefined,
      toggleDetails: () => prefs.setDetailsOpen(!detailsOpen),
      up: () => {
        if (crumbs.length > 1) navigate(crumbs[crumbs.length - 2].to);
      },
    },
  });

  // Details panel follows the selection.
  const detailsNode =
    (selectedNodes.length === 1 ? selectedNodes[0] : null) ||
    (detailsNodeId && selectedNodes.length === 0 ? sorted.find((n) => n.id === detailsNodeId) || null : null);

  const images = sorted.filter((n) => isImageNode(n)).length;
  const files = sorted.filter((n) => n.kind === 'file').length;
  const suggestGallery =
    !galleryHintHidden && (prefs.viewMode === 'list' || prefs.viewMode === 'details') && images >= 6 && images / Math.max(1, files) >= 0.6;

  const barActions: BarAction[] = [
    {
      id: 'dl',
      label: selectedNodes.length === 1 && selectedNodes[0].kind === 'file' ? t('common.download') : t('files.downloadZip'),
      icon: selectedNodes.length === 1 && selectedNodes[0].kind === 'file' ? <DownloadIcon size={16} /> : <ArchiveIcon size={16} />,
      priority: 1,
      onClick: () => void ops.download(selectedNodes),
    },
    {
      id: 'share',
      label: t('files.share'),
      icon: <ShareIcon size={16} />,
      hidden: !canShare || selectedNodes.length !== 1,
      priority: 3,
      onClick: () => showDetails(selectedNodes[0], 'sharing'),
    },
    { id: 'move', label: t('files.moveTo'), icon: <FolderMoveIcon size={16} />, hidden: !canWrite, priority: 4, onClick: () => ops.moveTo(selectedNodes) },
    { id: 'copy', label: t('files.copyTo'), icon: <CopyIcon size={16} />, priority: 5, onClick: () => ops.copyTo(selectedNodes) },
    {
      id: 'rename',
      label: t('files.rename'),
      icon: <PencilIcon size={16} />,
      hidden: !canWrite || selectedNodes.length !== 1,
      priority: 6,
      onClick: () => ops.rename(selectedNodes[0]),
    },
    { id: 'trash', label: t('files.moveToTrash'), icon: <TrashIcon size={16} />, danger: true, hidden: !canWrite, priority: 2, onClick: () => ops.trash(selectedNodes) },
  ];

  const target = workspaceId ? { workspaceId, parentId: listParent, label: folderName } : null;
  const emptyState = (
    <EmptyFolder
      canWrite={canWrite}
      onUpload={target ? () => pickFiles(target) : undefined}
      onUploadFolder={target ? () => pickFolder(target) : undefined}
      onNewFolder={ops.newFolder}
    />
  );

  const notFound = wsLoaded && !shared && workspaceId && !ws;
  const loadFailed = !folder.loading && folder.error && folder.nodes.length === 0;

  const view: FileViewMode = prefs.viewMode;
  const listProps = {
    nodes: sorted,
    scrollRef,
    selection: sel,
    label: t('files.listLabel', { folder: folderName }),
    onOpen: openNode,
    onMenu: openMenu,
    dnd: dnd.row,
    emptyState,
  };

  return (
    <div className="flex min-h-0 flex-1">
      {pickerInputs}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-16 shrink-0 items-center gap-2 px-3 py-2 sm:px-4 lg:px-6">
          {sel.selected.size > 0 ? (
            <SelectionBar
              count={sel.selected.size}
              actions={barActions}
              onClear={sel.clear}
              overflow={[
                { id: 'all', label: t('selection.selectAll'), onSelect: sel.selectAll },
                { id: 'details', label: t('files.details'), onSelect: () => prefs.setDetailsOpen(true) },
              ]}
            />
          ) : (
            <>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Breadcrumbs
                  crumbs={crumbs}
                  dropTargetId={dnd.crumb.dropTargetId}
                  onDragOverCrumb={dnd.crumb.onDragOverCrumb}
                  onDragLeaveCrumb={dnd.crumb.onDragLeaveCrumb}
                  onDrop={(e, id) => dnd.crumb.onDrop(e, id, crumbs.find((c) => c.id === id)?.name || rootLabel)}
                />
                {shared && sharedRoot && (
                  <Badge tone={canWrite ? 'accent' : 'neutral'} icon={canWrite ? undefined : <EyeIcon size={11} />} className="max-sm:hidden">
                    {canWrite ? t('share.canEdit') : t('files.viewOnly')}
                  </Badge>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
                {canWrite && (
                  <Button size="sm" variant="secondary" icon={<FolderPlusIcon size={15} />} onClick={ops.newFolder} className="max-md:hidden">
                    {t('files.newFolder')}
                  </Button>
                )}
                <div className="max-sm:hidden">
                  <ViewSwitcher value={view} onChange={prefs.setViewMode} />
                </div>
                <MobileViewMenu value={view} onChange={prefs.setViewMode} sort={prefs.sort} onSort={prefs.setSort} />
                {(view === 'tiles' || view === 'gallery') && <SortMenu sort={prefs.sort} onSort={prefs.setSort} />}
                <DetailsToggle open={detailsOpen} onToggle={() => prefs.setDetailsOpen(!detailsOpen)} />
              </div>
            </>
          )}
        </div>

        {suggestGallery && (
          <div className="mx-3 mb-2 flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-2 text-sm sm:mx-4 lg:mx-6">
            <GalleryIcon size={16} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 text-muted">{t('files.gallerySuggest')}</span>
            <Button size="sm" variant="secondary" onClick={() => prefs.setViewMode('gallery')}>
              {t('files.galleryOpen')}
            </Button>
            <button
              type="button"
              onClick={() => setGalleryHintHidden(true)}
              aria-label={t('common.dismiss')}
              className="flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-ink"
            >
              <CloseIcon size={14} />
            </button>
          </div>
        )}

        <div
          ref={scrollRef}
          onContextMenu={paneMenu}
          onClick={(e) => {
            if (e.target === e.currentTarget) sel.clear();
          }}
          className="scroll-slim relative min-h-0 flex-1 overflow-y-auto px-1.5 pb-24 sm:px-2.5 lg:px-4 lg:pb-8"
        >
          {notFound || (loadFailed && (folder.status === 404 || folder.status === 403)) ? (
            <EmptyState
              icon={<AlertIcon size={22} />}
              title={t('files.notFoundTitle')}
              hint={t('files.notFoundHint')}
              action={
                <Link to="/" className="text-sm font-medium text-accent-strong hover:underline">
                  {t('files.backHome')}
                </Link>
              }
            />
          ) : loadFailed ? (
            <EmptyState
              icon={<AlertIcon size={22} />}
              title={t('files.loadFailed')}
              hint={folder.error}
              action={
                <Button size="sm" variant="secondary" onClick={() => void folder.reload()}>
                  {t('common.retry')}
                </Button>
              }
            />
          ) : folder.loading && sorted.length === 0 ? (
            <ListSkeleton />
          ) : view === 'list' || view === 'details' ? (
            <FileList
              {...listProps}
              mode={view}
              sort={prefs.sort}
              onSort={prefs.toggleSort}
              columns={ws?.type === 'team' ? ['owner', 'type', 'created'] : ['type', 'created']}
              ownerName={(n) => {
                if (!n.created_by) return '—';
                if (n.created_by === user?.id) return t('files.me');
                const m = members.find((x) => x.user_id === n.created_by);
                return m?.display_name || m?.email || '—';
              }}
              rowActions={(n) => (
                <>
                  {canShare && (
                    <RowAction label={t('files.shareName', { name: n.name })} onClick={() => showDetails(n, 'sharing')}>
                      <ShareIcon size={15} />
                    </RowAction>
                  )}
                  {n.kind === 'file' ? (
                    <RowAction label={t('files.downloadName', { name: n.name })} href={downloadUrl(n.id)}>
                      <DownloadIcon size={15} />
                    </RowAction>
                  ) : (
                    <RowAction label={t('files.downloadName', { name: n.name })} onClick={() => void ops.download([n])}>
                      <DownloadIcon size={15} />
                    </RowAction>
                  )}
                </>
              )}
            />
          ) : (
            <FileGrid {...listProps} mode={view} onColumns={setGridCols} />
          )}
        </div>
      </div>

      {detailsOpen && (
        <DetailsPanel
          node={detailsNode}
          selectionCount={selectedNodes.length}
          selectionBytes={selectedNodes.reduce((a, n) => a + (n.kind === 'file' ? n.size : 0), 0)}
          folder={{ name: folderName, count: sorted.length }}
          tab={detailsTab}
          onTab={setDetailsTab}
          onClose={() => prefs.setDetailsOpen(false)}
          onOpen={openNode}
          location={crumbs.map((c) => c.name).join(' / ')}
          owner={
            detailsNode?.created_by
              ? detailsNode.created_by === user?.id
                ? t('files.me')
                : members.find((m) => m.user_id === detailsNode.created_by)?.display_name
              : undefined
          }
          workspaces={workspaces.filter((w) => w.type !== 'mount')}
          canWrite={canWrite}
          canShare={canShare}
          onChanged={() => void folder.reload(true)}
        />
      )}

      {menu && (
        <MenuList
          items={menu.items}
          point={menu.point}
          anchor={menu.anchor}
          align="end"
          label={t('files.actions')}
          onClose={() => setMenu(null)}
        />
      )}
      {ops.dialogs}
      {opener.element}
    </div>
  );
}

/** Phones: one dropdown for layout + sort, since header columns are hidden. */
function MobileViewMenu({
  value,
  onChange,
  sort,
  onSort,
}: {
  value: FileViewMode;
  onChange: (m: FileViewMode) => void;
  sort: SortSpec;
  onSort: (s: SortSpec) => void;
}) {
  const { t } = useI18n();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <span className="sm:hidden">
      <button
        type="button"
        aria-label={t('view.label')}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        className="flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink"
      >
        {value === 'gallery' ? <GalleryIcon size={18} /> : value === 'tiles' ? <TilesViewIcon size={18} /> : <ListViewIcon size={18} />}
      </button>
      {anchor && (
        <MenuList
          anchor={anchor}
          align="end"
          label={t('view.label')}
          onClose={() => setAnchor(null)}
          items={[
            { kind: 'label', id: 'l', label: t('view.label') },
            { id: 'list', label: t('view.list'), checked: value === 'list' || value === 'details', onSelect: () => onChange('list') },
            { id: 'tiles', label: t('view.tiles'), checked: value === 'tiles', onSelect: () => onChange('tiles') },
            { id: 'gallery', label: t('view.gallery'), checked: value === 'gallery', onSelect: () => onChange('gallery') },
            { kind: 'separator', id: 's' },
            { kind: 'label', id: 'l2', label: t('sort.by') },
            ...(['name', 'modified', 'size'] as const).map((k) => ({
              id: `sort-${k}`,
              label: t(`sort.${k}`),
              checked: sort.key === k,
              onSelect: () => onSort({ key: k, dir: k === 'name' ? 'asc' : 'desc' }),
            })),
          ]}
        />
      )}
    </span>
  );
}
