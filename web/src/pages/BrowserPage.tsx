import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  downloadUrl,
  isPreviewable,
  type Node,
} from '../lib/api';
import { Toast, type ToastState } from '../components/Toast';
import { useConfirm } from '../lib/confirm';
import { FilesSidebar } from '../components/files/FilesSidebar';
import { FileToolbar } from '../components/files/FileToolbar';
import { ContextMenu } from '../components/files/ContextMenu';
import {
  FileDetailsView,
  FileListView,
  FileTilesView,
  type FileViewHandlers,
} from '../components/files/FileViews';
import {
  LiveDriveList,
  RecentList,
  SharedBrowse,
} from '../components/files/SecondaryLists';
import type { ContextMenuState, FileViewMode } from '../components/files/types';
import { BrowserModals, type NamePromptState } from './browser/BrowserModals';
import { workspaceLabel } from './browser/types';
import { useBrowserData } from './browser/useBrowserData';
import { useFileDnD } from './browser/useFileDnD';
import { useSelection } from './browser/useSelection';

const VIEW_KEY = 'arkive.files.viewMode';

function loadViewMode(): FileViewMode {
  const v = localStorage.getItem(VIEW_KEY);
  if (v === 'list' || v === 'details' || v === 'tiles') return v;
  return 'list';
}

export function BrowserPage() {
  const [error, setError] = useState('');
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [shareNode, setShareNode] = useState<Node | null>(null);
  const [previewNode, setPreviewNode] = useState<Node | null>(null);
  const [previewStartEditing, setPreviewStartEditing] = useState(false);
  const [historyNode, setHistoryNode] = useState<Node | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [moveMode, setMoveMode] = useState<'move' | 'copy'>('move');
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<FileViewMode>(loadViewMode);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [namePrompt, setNamePrompt] = useState<NamePromptState>(null);
  const [nameBusy, setNameBusy] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | null>(null);
  const { ask, dialog: confirmDialog, isOpen: confirmOpen } = useConfirm();

  const showToast = useCallback((message: string, ms = 4000) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), message });
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }, []);

  const {
    selected,
    setSelected,
    clipboard,
    setClipboard,
    toggleSelect,
    copyToClipboard,
  } = useSelection({ showToast });

  const {
    workspaces,
    view,
    setView,
    parentId,
    setParentId,
    nodes,
    setNodes,
    breadcrumbs,
    shared,
    trash,
    recent,
    liveItems,
    setLiveItems,
    results,
    setResults,
    rootBytes,
    rootQuota,
    totalBytes,
    totalFiles,
    totalQuota,
    workspaceId,
    loadNodes,
    refreshUsage,
  } = useBrowserData({
    query,
    setError,
    setSelected,
    setToast,
    toastTimer,
  });

  const browsing = view?.kind === 'workspace' || view?.kind === 'shared-folder';
  const sharedBrowse = view?.kind === 'shared-folder';
  const personal = workspaces.find((w) => w.type === 'personal');
  const teams = workspaces.filter((w) => w.type === 'team');
  const mounts = workspaces.filter((w) => w.type === 'mount');
  const activeWorkspace = workspaces.find((w) => w.id === workspaceId);
  const canWriteFiles =
    view?.kind === 'shared-folder'
      ? view.permission === 'write'
      : !activeWorkspace?.role ||
        activeWorkspace.role === 'owner' ||
        activeWorkspace.role === 'admin' ||
        activeWorkspace.role === 'member';

  const selectWorkspace = useCallback((id: string) => {
    setView({ kind: 'workspace', id });
    setParentId(null);
    setQuery('');
    setResults(null);
    setShowTrash(false);
    setSelected(new Set());
  }, [setView, setParentId, setResults, setSelected]);

  function showUndoToast(nodeIds: string[]) {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    const id = Date.now();
    setToast({
      id,
      message: nodeIds.length > 1 ? `Moved ${nodeIds.length} items to trash` : 'Moved to trash',
      action: {
        label: 'Undo',
        onClick: () => {
          void (async () => {
            try {
              for (const nid of nodeIds) await api.restore(nid);
              await loadNodes();
              await refreshUsage();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Undo failed');
            }
          })();
        },
      },
    });
    toastTimer.current = window.setTimeout(() => setToast(null), 10000);
  }

  function setViewModePersist(m: FileViewMode) {
    setViewMode(m);
    localStorage.setItem(VIEW_KEY, m);
  }

  function createFolder() {
    if (!workspaceId) return;
    setNamePrompt({ kind: 'mkdir' });
  }

  function createFile() {
    if (!workspaceId || !canWriteFiles) return;
    setNamePrompt({ kind: 'newfile' });
  }

  function normalizeNewTextName(raw: string) {
    const name = raw.trim();
    if (!name) return '';
    if (/\.[^./\\]+$/.test(name)) return name;
    return `${name}.txt`;
  }

  function mimeForTextName(name: string) {
    if (/\.(md|markdown)$/i.test(name)) return 'text/markdown; charset=utf-8';
    return 'text/plain; charset=utf-8';
  }

  async function submitNamePrompt(name: string) {
    if (!namePrompt) return;
    setNameBusy(true);
    setError('');
    try {
      if (namePrompt.kind === 'mkdir') {
        if (!workspaceId) return;
        const into =
          view?.kind === 'shared-folder' ? (parentId ?? view.rootId) : parentId;
        await api.mkdir(workspaceId, name, into);
        setNamePrompt(null);
        await loadNodes();
        await refreshUsage();
      } else if (namePrompt.kind === 'newfile') {
        if (!workspaceId) return;
        const fileName = normalizeNewTextName(name);
        if (!fileName) return;
        const into =
          view?.kind === 'shared-folder' ? (parentId ?? view.rootId) : parentId;
        const file = new File([''], fileName, { type: mimeForTextName(fileName) });
        const created = await api.upload(workspaceId, file, into);
        setNamePrompt(null);
        await loadNodes();
        await refreshUsage();
        openPreview(created, true);
      } else {
        await api.rename(namePrompt.node.id, name);
        setNamePrompt(null);
        await loadNodes();
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : namePrompt.kind === 'mkdir'
            ? 'Could not create folder'
            : namePrompt.kind === 'newfile'
              ? 'Could not create file'
              : 'Rename failed',
      );
    } finally {
      setNameBusy(false);
    }
  }

  async function onUpload(
    files: FileList | File[] | null,
    intoParent: string | null = parentId,
  ) {
    if (!workspaceId || !files || (files as FileList).length === 0) return;
    setError('');
    try {
      for (const file of Array.from(files)) {
        setUploadPct(0);
        await api.upload(workspaceId, file, intoParent, setUploadPct);
      }
      setUploadPct(null);
      await loadNodes();
      await refreshUsage();
    } catch (e) {
      setUploadPct(null);
      setError(e instanceof Error ? e.message : 'Upload failed');
    }
  }

  function renameNode(node: Node) {
    setNamePrompt({ kind: 'rename', node });
  }

  function deleteNode(node: Node) {
    ask({
      title: 'Move to trash',
      message: `Move “${node.name}” to trash?`,
      confirmLabel: 'Move to trash',
      run: async () => {
        try {
          await api.remove(node.id);
          await loadNodes();
          await refreshUsage();
          showUndoToast([node.id]);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Delete failed');
          throw e;
        }
      },
    });
  }

  const bulkDelete = useCallback(() => {
    const ids = [...selected];
    if (!ids.length) return;
    ask({
      title: 'Move to trash',
      message: `Move ${ids.length} item(s) to trash?`,
      confirmLabel: 'Move to trash',
      run: async () => {
        try {
          for (const id of ids) await api.remove(id);
          await loadNodes();
          await refreshUsage();
          showUndoToast(ids);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Delete failed');
          throw e;
        }
      },
    });
  }, [selected, loadNodes, ask, refreshUsage]);

  async function pasteClipboard() {
    if (!workspaceId || !clipboard?.length) return;
    try {
      await api.copyNodes(clipboard, workspaceId, parentId);
      setClipboard(null);
      await loadNodes();
      await refreshUsage();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Paste failed');
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (confirmOpen) return;
      if (!browsing) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(new Set(nodes.map((n) => n.id)));
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selected.size > 0) {
        e.preventDefault();
        copyToClipboard([...selected]);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && clipboard?.length) {
        e.preventDefault();
        void pasteClipboard();
      }
      if (e.key === 'Escape') {
        setSelected(new Set());
        setPreviewNode(null);
        setPreviewStartEditing(false);
        setShowMove(false);
        setContextMenu(null);
      }
      if (e.key === 'Delete' && selected.size > 0) {
        e.preventDefault();
        bulkDelete();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nodes, selected, bulkDelete, browsing, confirmOpen, clipboard, copyToClipboard, setSelected]);

  async function bulkZip() {
    if (!workspaceId) return;
    try {
      await api.downloadZip(workspaceId, [...selected]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Zip failed');
    }
  }

  async function restoreNode(node: Node) {
    try {
      await api.restore(node.id);
      await loadNodes();
      await refreshUsage();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed');
    }
  }

  function purgeNode(node: Node) {
    ask({
      title: 'Delete forever',
      message: `Permanently delete “${node.name}”? This cannot be undone.`,
      confirmLabel: 'Delete forever',
      run: async () => {
        try {
          await api.purge(node.id);
          await loadNodes();
          await refreshUsage();
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Purge failed');
          throw e;
        }
      },
    });
  }

  function openPreview(node: Node, edit = false) {
    setPreviewStartEditing(edit);
    setPreviewNode(node);
  }

  async function moveNodesInto(ids: string[], targetParent: string | null) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    try {
      for (const id of ids) {
        if (id === targetParent) continue;
        const n = byId.get(id);
        if (!n) continue;
        await api.move(id, n.name, targetParent);
      }
      await loadNodes();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Move failed');
    }
  }

  const {
    dragging,
    dropTargetId,
    setDropTargetId,
    suppressOpenAfterDrag,
    hasOsFiles,
    hasInternalNodes,
    onDragStartNode,
    onDragEndNode,
    onDragOverFolder,
    onDragLeaveFolder,
    onDropOnFolder,
    onDropOnBreadcrumb,
    onRootDragEnter,
    onRootDragOver,
    onRootDragLeave,
    onRootDrop,
  } = useFileDnD({
    selected,
    browsing,
    parentId,
    onUpload,
    moveNodesInto,
  });

  function openNode(node: Node) {
    // A dragend often synthesizes a click; ignore it so we don't open mid-move.
    if (suppressOpenAfterDrag.current) return;
    if (results) {
      setParentId(node.parent_id || null);
      setQuery('');
      setResults(null);
      if (node.kind === 'file' && isPreviewable(node)) openPreview(node);
      return;
    }
    if (node.kind === 'folder') {
      setParentId(node.id);
      setQuery('');
      setResults(null);
      return;
    }
    if (isPreviewable(node)) openPreview(node);
    else window.open(downloadUrl(node.id), '_blank');
  }

  function openMoveFor(nodesToMove: Node[], mode: 'move' | 'copy' = 'move') {
    setSelected(new Set(nodesToMove.map((n) => n.id)));
    setMoveMode(mode);
    setShowMove(true);
  }

  const selectedNodes = nodes.filter((n) => selected.has(n.id));
  const list = results ?? nodes;
  const activeTitle =
    view?.kind === 'shared' || view?.kind === 'shared-folder'
      ? 'Shared with me'
      : view?.kind === 'recent'
        ? 'Recent'
        : view?.kind === 'live-drive'
          ? 'Google Drive (live)'
          : workspaces.find((w) => w.id === workspaceId)
            ? workspaceLabel(workspaces.find((w) => w.id === workspaceId)!)
            : 'Files';

  const sidebarActive =
    view?.kind === 'shared' || view?.kind === 'shared-folder'
      ? ({ kind: 'shared' } as const)
      : view?.kind === 'recent'
        ? ({ kind: 'recent' } as const)
        : view?.kind === 'live-drive'
          ? ({ kind: 'live-drive' } as const)
          : view?.kind === 'workspace'
            ? ({ kind: 'workspace', id: view.id } as const)
            : null;

  const viewHandlers: FileViewHandlers = {
    selected,
    dropTargetId,
    onToggleSelect: toggleSelect,
    onOpen: openNode,
    onPreview: (n) => openPreview(n),
    onHistory: (n) => setHistoryNode(n),
    onShare: (n) => setShareNode(n),
    onRename: renameNode,
    onDelete: deleteNode,
    onContextMenu: (e, node) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ kind: 'node', node, x: e.clientX, y: e.clientY });
    },
    onDragStart: onDragStartNode,
    onDragEnd: onDragEndNode,
    onDragOverFolder,
    onDragLeaveFolder,
    onDropOnFolder,
  };

  return (
    <div
      onDragEnter={onRootDragEnter}
      onDragOver={onRootDragOver}
      onDragLeave={onRootDragLeave}
      onDrop={onRootDrop}
      className="relative flex min-h-0 flex-1 flex-col gap-6 lg:flex-row lg:items-stretch"
    >
      {dragging && browsing && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-arkive-amber/60 bg-arkive-amber/10 text-arkive-amber">
          Drop files to upload
        </div>
      )}

      <FilesSidebar
        personal={personal}
        teams={teams}
        mounts={mounts}
        active={sidebarActive}
        sharedCount={shared.length}
        totalBytes={totalBytes}
        totalFiles={totalFiles}
        totalQuota={totalQuota}
        onSelectWorkspace={selectWorkspace}
        onSelectShared={() => {
          setView({ kind: 'shared' });
          setParentId(null);
          setShowTrash(false);
          setQuery('');
          setResults(null);
          setSelected(new Set());
        }}
        onSelectRecent={() => {
          setView({ kind: 'recent' });
          setShowTrash(false);
          setQuery('');
          setResults(null);
        }}
        onSelectLiveDrive={() => {
          setView({ kind: 'live-drive', parent: 'root' });
          setShowTrash(false);
          setQuery('');
          setResults(null);
        }}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <FileToolbar
          title={activeTitle}
          subtitle={
            view?.kind === 'shared'
              ? 'Files and folders others shared with you.'
              : view?.kind === 'recent'
                ? 'Recent activity across your roots.'
                : view?.kind === 'live-drive'
                  ? 'Browse Google Drive live (not stored in Arkive).'
                  : 'Drag files onto folders to upload, or drag items to move.'
          }
          browsing={browsing}
          showViewModes={view?.kind === 'shared'}
          viewMode={viewMode}
          onViewMode={setViewModePersist}
          query={query}
          onQuery={setQuery}
          rootBytes={view?.kind === 'workspace' ? rootBytes : null}
          rootQuota={view?.kind === 'workspace' ? rootQuota : null}
          trashCount={trash.length}
          showTrash={showTrash}
          onToggleTrash={() => setShowTrash((v) => !v)}
          onNewFolder={createFolder}
          onNewFile={canWriteFiles ? createFile : undefined}
          onUpload={() => fileRef.current?.click()}
          hideTrash={sharedBrowse}
        />
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => void onUpload(e.target.files)}
        />

        {view?.kind === 'shared' ? (
          <SharedBrowse
            nodes={shared}
            viewMode={viewMode}
            onOpen={(node) => {
              if (node.kind === 'folder') {
                setView({
                  kind: 'shared-folder',
                  workspaceId: node.workspace_id,
                  rootId: node.id,
                  parentId: node.id,
                  permission: node.permission === 'write' ? 'write' : 'read',
                });
                setParentId(node.id);
              } else if (isPreviewable(node)) openPreview(node);
              else window.open(downloadUrl(node.id), '_blank');
            }}
          />
        ) : view?.kind === 'recent' ? (
          <RecentList
            items={recent}
            onOpen={(ev) => {
              if (ev.workspace_id) {
                selectWorkspace(ev.workspace_id);
                setParentId(ev.parent_id || null);
              }
            }}
          />
        ) : view?.kind === 'live-drive' ? (
          <LiveDriveList
            items={liveItems}
            parent={view.parent}
            dropTargetId={dropTargetId}
            onUp={() => setView({ kind: 'live-drive', parent: 'root' })}
            onOpen={(item) => {
              if (item.kind === 'folder') setView({ kind: 'live-drive', parent: item.id });
              else window.open(api.liveDriveDownloadUrl(item.id), '_blank');
            }}
            onDropFiles={(files, parentId) => {
              void (async () => {
                try {
                  for (const f of Array.from(files)) {
                    await api.liveDriveUpload(f, parentId);
                  }
                  const data = await api.liveDriveList(
                    parentId === 'root' ? undefined : parentId,
                  );
                  setLiveItems(data.items);
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Drive upload failed');
                }
              })();
            }}
            onMoveItem={(fileId, newParent) => {
              void (async () => {
                try {
                  await api.liveDriveMove(fileId, newParent, view.parent);
                  const data = await api.liveDriveList(
                    view.parent === 'root' ? undefined : view.parent,
                  );
                  setLiveItems(data.items);
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Drive move failed');
                }
              })();
            }}
            onDragOverFolder={(id) => setDropTargetId(id)}
            onDragLeaveFolder={() => setDropTargetId(null)}
          />
        ) : (
          <>
            {selected.size > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-arkive-border bg-arkive-panel/50 px-3 py-2 text-sm">
                <span className="text-arkive-muted">{selected.size} selected</span>
                <button
                  type="button"
                  onClick={() => {
                    setMoveMode('move');
                    setShowMove(true);
                  }}
                  className="rounded-md border border-arkive-border px-2 py-1 hover:border-arkive-amber/40"
                >
                  Move
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMoveMode('copy');
                    setShowMove(true);
                  }}
                  className="rounded-md border border-arkive-border px-2 py-1 hover:border-arkive-amber/40"
                >
                  Copy to…
                </button>
                <button
                  type="button"
                  onClick={() => void bulkZip()}
                  className="rounded-md border border-arkive-border px-2 py-1 hover:border-arkive-amber/40"
                >
                  Download zip
                </button>
                <button
                  type="button"
                  onClick={() => bulkDelete()}
                  className="rounded-md border border-arkive-border px-2 py-1 hover:text-red-300"
                >
                  Trash
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="rounded-md px-2 py-1 text-arkive-muted hover:text-arkive-text"
                >
                  Clear
                </button>
              </div>
            )}

            {!results && (
              <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm text-arkive-muted">
                <button
                  type="button"
                  onClick={() => setParentId(null)}
                  onDragOver={(e) => {
                    if (!hasOsFiles(e) && !hasInternalNodes(e)) return;
                    e.preventDefault();
                    setDropTargetId('__root__');
                  }}
                  onDragLeave={() =>
                    setDropTargetId((c) => (c === '__root__' ? null : c))
                  }
                  onDrop={(e) => void onDropOnBreadcrumb(e, null)}
                  className={`rounded px-1.5 py-0.5 hover:bg-arkive-panel hover:text-arkive-text ${
                    dropTargetId === '__root__' ? 'ring-2 ring-arkive-amber/70' : ''
                  }`}
                >
                  Root
                </button>
                {breadcrumbs.map((b) => (
                  <span key={b.id} className="flex items-center gap-1">
                    <span>/</span>
                    <button
                      type="button"
                      onClick={() => setParentId(b.id)}
                      onDragOver={(e) => {
                        if (!hasOsFiles(e) && !hasInternalNodes(e)) return;
                        e.preventDefault();
                        setDropTargetId(b.id);
                      }}
                      onDragLeave={() =>
                        setDropTargetId((c) => (c === b.id ? null : c))
                      }
                      onDrop={(e) => void onDropOnBreadcrumb(e, b.id)}
                      className={`rounded px-1.5 py-0.5 hover:bg-arkive-panel hover:text-arkive-text ${
                        dropTargetId === b.id ? 'ring-2 ring-arkive-amber/70' : ''
                      }`}
                    >
                      {b.name}
                    </button>
                  </span>
                ))}
              </nav>
            )}

            {results && (
              <p className="mb-3 text-sm text-arkive-muted">
                Search results for “{query}” —{' '}
                <button
                  type="button"
                  className="text-arkive-amber hover:underline"
                  onClick={() => setQuery('')}
                >
                  clear
                </button>
              </p>
            )}

            {uploadPct !== null && (
              <div className="mb-4 overflow-hidden rounded-lg border border-arkive-border bg-arkive-panel">
                <div
                  className="h-1.5 bg-gradient-to-r from-arkive-orange to-arkive-glow transition-all"
                  style={{ width: `${uploadPct}%` }}
                />
                <p className="px-3 py-2 text-xs text-arkive-muted">Uploading… {uploadPct}%</p>
              </div>
            )}

            {error && (
              <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}

            <div
              data-file-pane
              className="flex min-h-[16rem] flex-1 flex-col"
              onContextMenu={(e) => {
                if (!browsing || results) return;
                const t = e.target as HTMLElement;
                // File/folder rows open the item menu; empty pane (and empty-state copy) open create/upload.
                if (t.closest('[data-file-row]')) return;
                if (t.closest('button, a, input, textarea, select')) return;
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({ kind: 'pane', x: e.clientX, y: e.clientY });
              }}
            >
              {viewMode === 'details' ? (
                <FileDetailsView nodes={list} results={!!results} handlers={viewHandlers} />
              ) : viewMode === 'tiles' ? (
                <FileTilesView nodes={list} results={!!results} handlers={viewHandlers} />
              ) : (
                <FileListView nodes={list} results={!!results} handlers={viewHandlers} />
              )}
            </div>

            {showTrash && (
              <section className="mt-8">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="font-display text-lg font-semibold">Trash</h2>
                  {trash.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        ask({
                          title: 'Empty trash',
                          message: `Permanently delete all ${trash.length} item(s) in trash? This cannot be undone.`,
                          confirmLabel: 'Empty trash',
                          run: async () => {
                            try {
                              await api.emptyTrash(workspaceId);
                              await loadNodes();
                              await refreshUsage();
                            } catch (e) {
                              setError(String(e));
                              throw e;
                            }
                          },
                        })
                      }
                      className="rounded-md border border-arkive-border px-2 py-1 text-xs hover:text-red-300"
                    >
                      Empty trash
                    </button>
                  )}
                </div>
                <ul className="divide-y divide-arkive-border overflow-hidden rounded-2xl border border-arkive-border bg-arkive-surface/50">
                  {trash.length === 0 && (
                    <li className="px-4 py-6 text-center text-sm text-arkive-muted">Trash is empty.</li>
                  )}
                  {trash.map((node) => (
                    <li
                      key={node.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                    >
                      <span>
                        {node.name} <span className="text-arkive-muted">({node.kind})</span>
                      </span>
                      <div className="flex gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => void restoreNode(node)}
                          className="rounded-md border border-arkive-border px-2 py-1 hover:border-arkive-amber/40"
                        >
                          Restore
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            purgeNode(node);
                          }}
                          className="rounded-md border border-arkive-border px-2 py-1 hover:text-red-300"
                        >
                          Delete forever
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {error && view?.kind === 'shared' && (
          <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
      </div>

      <ContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu(null)}
        onOpen={openNode}
        onPreview={(n) => openPreview(n)}
        onEdit={(n) => openPreview(n, true)}
        onShare={(n) => setShareNode(n)}
        onHistory={(n) => setHistoryNode(n)}
        onRename={renameNode}
        onMove={(n) => openMoveFor([n], 'move')}
        onCopy={(n) => {
          const ids =
            selected.has(n.id) && selected.size > 0 ? [...selected] : [n.id];
          copyToClipboard(ids);
        }}
        onCopyTo={(n) => openMoveFor(
          selected.has(n.id) && selected.size > 0
            ? nodes.filter((x) => selected.has(x.id))
            : [n],
          'copy',
        )}
        onTrash={deleteNode}
        onNewFolder={createFolder}
        onNewFile={canWriteFiles ? createFile : undefined}
        onUpload={() => fileRef.current?.click()}
        canPaste={!!clipboard?.length}
        onPaste={() => void pasteClipboard()}
        canWrite={canWriteFiles}
      />

      <BrowserModals
        namePrompt={namePrompt}
        nameBusy={nameBusy}
        onConfirmName={(name) => void submitNamePrompt(name)}
        onCloseNamePrompt={() => {
          if (!nameBusy) setNamePrompt(null);
        }}
        shareNode={shareNode}
        workspaces={workspaces}
        onCloseShare={() => setShareNode(null)}
        previewNode={previewNode}
        previewStartEditing={previewStartEditing}
        canWrite={canWriteFiles}
        onClosePreview={() => {
          setPreviewNode(null);
          setPreviewStartEditing(false);
        }}
        onPreviewSaved={(updated) => {
          setPreviewNode(updated);
          setPreviewStartEditing(false);
          setNodes((prev) =>
            prev.map((n) => (n.id === updated.id ? { ...n, ...updated } : n)),
          );
          void refreshUsage();
          showToast('File saved');
        }}
        historyNode={historyNode}
        onCloseHistory={() => setHistoryNode(null)}
        showMove={showMove}
        selectedNodes={selectedNodes}
        workspaceId={workspaceId}
        moveMode={moveMode}
        onCloseMove={() => setShowMove(false)}
        onMoved={() => {
          void loadNodes();
          void refreshUsage();
        }}
      />

      {confirmDialog}
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
