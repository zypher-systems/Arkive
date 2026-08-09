import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  api,
  downloadUrl,
  formatBytes,
  isPreviewable,
  type Breadcrumb,
  type Node,
  type Workspace,
} from '../lib/api';
import { SharePanel } from '../components/SharePanel';
import { PreviewModal } from '../components/PreviewModal';
import { MoveDialog } from '../components/MoveDialog';
import { VersionsPanel } from '../components/VersionsPanel';
import { Toast, type ToastState } from '../components/Toast';
import { useConfirm } from '../lib/confirm';
import type { LiveDriveItem, RecentItem } from '../lib/api';

type NavView =
  | { kind: 'workspace'; id: string }
  | { kind: 'shared' }
  | { kind: 'shared-folder'; workspaceId: string; rootId: string; parentId: string | null }
  | { kind: 'recent' }
  | { kind: 'live-drive'; parent: string };

function workspaceLabel(w: Workspace) {
  if (w.type === 'personal') return 'My files';
  if (w.type === 'mount') return w.name || 'Google Drive';
  return w.name;
}

function navButtonClass(active: boolean) {
  return `w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
    active
      ? 'bg-arkive-amber/15 text-arkive-text'
      : 'text-arkive-muted hover:bg-arkive-panel/70 hover:text-arkive-text'
  }`;
}

export function BrowserPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [view, setView] = useState<NavView | null>(null);
  const [parentId, setParentId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [error, setError] = useState('');
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [shareNode, setShareNode] = useState<Node | null>(null);
  const [previewNode, setPreviewNode] = useState<Node | null>(null);
  const [historyNode, setHistoryNode] = useState<Node | null>(null);
  const [shared, setShared] = useState<Node[]>([]);
  const [trash, setTrash] = useState<Node[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Node[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<number | null>(null);
  const { ask, dialog: confirmDialog, isOpen: confirmOpen } = useConfirm();
  const [toast, setToast] = useState<ToastState>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [liveItems, setLiveItems] = useState<LiveDriveItem[]>([]);
  const toastTimer = useRef<number | null>(null);

  const workspaceId =
    view?.kind === 'workspace'
      ? view.id
      : view?.kind === 'shared-folder'
        ? view.workspaceId
        : '';
  const browsing = view?.kind === 'workspace' || view?.kind === 'shared-folder';
  const sharedBrowse = view?.kind === 'shared-folder';
  const personal = workspaces.find((w) => w.type === 'personal');
  const teams = workspaces.filter((w) => w.type === 'team');
  const mounts = workspaces.filter((w) => w.type === 'mount');

  const selectWorkspace = useCallback((id: string) => {
    setView({ kind: 'workspace', id });
    setParentId(null);
    setQuery('');
    setResults(null);
    setShowTrash(false);
    setSelected(new Set());
  }, []);

  const loadWorkspaces = useCallback(async () => {
    const list = await api.workspaces();
    setWorkspaces(list);
    setView((prev) => {
      if (prev?.kind === 'shared') return prev;
      if (prev?.kind === 'workspace' && list.some((w) => w.id === prev.id)) return prev;
      const personalId = list.find((w) => w.type === 'personal')?.id;
      const fallback = personalId || list.find((w) => w.type !== 'mount')?.id || list[0]?.id;
      return fallback ? { kind: 'workspace', id: fallback } : null;
    });
  }, []);

  const loadNodes = useCallback(async () => {
    setShared(await api.sharedWithMe());
    setRecent(await api.recentActivity().catch(() => [] as RecentItem[]));
    if (view?.kind === 'live-drive') {
      const data = await api.liveDriveList(view.parent === 'root' ? undefined : view.parent);
      setLiveItems(data.items);
      return;
    }
    if (!workspaceId) {
      setNodes([]);
      setBreadcrumbs([]);
      setTrash([]);
      return;
    }
    const listParent =
      view?.kind === 'shared-folder' ? (parentId ?? view.rootId) : parentId;
    const data = await api.listNodes(workspaceId, listParent);
    setNodes(data.nodes);
    setBreadcrumbs(data.breadcrumbs);
    if (view?.kind === 'workspace') {
      setTrash(await api.trash(workspaceId));
    } else {
      setTrash([]);
    }
    setSelected(new Set());
  }, [workspaceId, parentId, view]);

  useEffect(() => {
    void loadWorkspaces().catch((e) => setError(String(e)));
  }, [loadWorkspaces]);

  useEffect(() => {
    if (view?.kind === 'shared' || view?.kind === 'recent') {
      void Promise.all([
        api.sharedWithMe(),
        api.recentActivity().catch(() => [] as RecentItem[]),
      ])
        .then(([s, r]) => {
          setShared(s);
          setRecent(r);
        })
        .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'));
      return;
    }
    void loadNodes().catch((e) => setError(e instanceof Error ? e.message : 'Load failed'));
  }, [loadNodes, view?.kind]);

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
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Undo failed');
            }
          })();
        },
      },
    });
    toastTimer.current = window.setTimeout(() => setToast(null), 10000);
  }

  useEffect(() => {
    if (!workspaceId || view?.kind !== 'workspace') return;
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    if (!query.trim()) {
      setResults(null);
      return;
    }
    searchTimer.current = window.setTimeout(() => {
      void api
        .search(workspaceId, query.trim())
        .then(setResults)
        .catch((e) => setError(e instanceof Error ? e.message : 'Search failed'));
    }, 250);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [query, workspaceId, view?.kind]);

  async function createFolder() {
    if (!workspaceId) return;
    const name = window.prompt('Folder name');
    if (!name) return;
    try {
      await api.mkdir(workspaceId, name, parentId);
      await loadNodes();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create folder');
    }
  }

  async function onUpload(files: FileList | File[] | null) {
    if (!workspaceId || !files || (files as FileList).length === 0) return;
    setError('');
    try {
      for (const file of Array.from(files)) {
        setUploadPct(0);
        await api.upload(workspaceId, file, parentId, setUploadPct);
      }
      setUploadPct(null);
      await loadNodes();
    } catch (e) {
      setUploadPct(null);
      setError(e instanceof Error ? e.message : 'Upload failed');
    }
  }

  async function renameNode(node: Node) {
    const name = window.prompt('Rename', node.name);
    if (!name || name === node.name) return;
    try {
      await api.rename(node.id, name);
      await loadNodes();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rename failed');
    }
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
          showUndoToast(ids);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Delete failed');
          throw e;
        }
      },
    });
  }, [selected, loadNodes, ask]);

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
      if (e.key === 'Escape') {
        setSelected(new Set());
        setPreviewNode(null);
        setShowMove(false);
      }
      if (e.key === 'Delete' && selected.size > 0) {
        e.preventDefault();
        bulkDelete();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nodes, selected, bulkDelete, browsing, confirmOpen]);

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
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Purge failed');
          throw e;
        }
      },
    });
  }

  function toggleSelect(id: string, e: MouseEvent) {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openNode(node: Node) {
    if (node.kind === 'folder') {
      setParentId(node.id);
      setQuery('');
      setResults(null);
      return;
    }
    if (isPreviewable(node)) setPreviewNode(node);
    else window.open(downloadUrl(node.id), '_blank');
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

  return (
    <div
      onDragEnter={(e) => {
        if (!browsing) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!browsing) return;
        e.preventDefault();
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!browsing) return;
        e.preventDefault();
        setDragging(false);
        void onUpload(e.dataTransfer.files);
      }}
      className="relative flex flex-col gap-6 lg:flex-row lg:items-start"
    >
      {dragging && browsing && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-arkive-amber/60 bg-arkive-amber/10 text-arkive-amber">
          Drop files to upload
        </div>
      )}

      <aside className="w-full shrink-0 rounded-2xl border border-arkive-border bg-arkive-surface/70 p-3 lg:sticky lg:top-20 lg:w-56">
        <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-arkive-muted">
          My files
        </p>
        <ul className="mb-4 space-y-0.5">
          {personal && (
            <li>
              <button
                type="button"
                className={navButtonClass(view?.kind === 'workspace' && view.id === personal.id)}
                onClick={() => selectWorkspace(personal.id)}
              >
                {workspaceLabel(personal)}
              </button>
            </li>
          )}
          {teams.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                className={navButtonClass(view?.kind === 'workspace' && view.id === w.id)}
                onClick={() => selectWorkspace(w.id)}
              >
                {workspaceLabel(w)}
              </button>
            </li>
          ))}
          {!personal && teams.length === 0 && (
            <li className="px-2.5 py-1.5 text-xs text-arkive-muted">No workspaces yet</li>
          )}
        </ul>

        <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-arkive-muted">
          Shared
        </p>
        <ul className="mb-4 space-y-0.5">
          <li>
            <button
              type="button"
              className={navButtonClass(view?.kind === 'shared' || view?.kind === 'shared-folder')}
              onClick={() => {
                setView({ kind: 'shared' });
                setParentId(null);
                setShowTrash(false);
                setQuery('');
                setResults(null);
                setSelected(new Set());
              }}
            >
              Shared with me{shared.length ? ` (${shared.length})` : ''}
            </button>
          </li>
          <li>
            <button
              type="button"
              className={navButtonClass(view?.kind === 'recent')}
              onClick={() => {
                setView({ kind: 'recent' });
                setShowTrash(false);
                setQuery('');
                setResults(null);
              }}
            >
              Recent
            </button>
          </li>
        </ul>

        <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-arkive-muted">
          Connected
        </p>
        <ul className="space-y-0.5">
          {mounts.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                className={navButtonClass(view?.kind === 'workspace' && view.id === w.id)}
                onClick={() => selectWorkspace(w.id)}
              >
                {workspaceLabel(w)}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className={navButtonClass(view?.kind === 'live-drive')}
              onClick={() => {
                setView({ kind: 'live-drive', parent: 'root' });
                setShowTrash(false);
                setQuery('');
                setResults(null);
              }}
            >
              Google Drive (live)
            </button>
          </li>
          {mounts.length === 0 && (
            <li className="px-2.5 py-1.5 text-xs text-arkive-muted">
              Connect clouds in Account
            </li>
          )}
        </ul>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">{activeTitle}</h1>
            <p className="mt-1 text-sm text-arkive-muted">
              {view?.kind === 'shared'
                ? 'Files and folders others shared with you.'
                : 'Drag files anywhere, multi-select with checkboxes, Delete to trash.'}
            </p>
          </div>
          {browsing && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search files…"
                className="w-40 rounded-lg border border-arkive-border bg-arkive-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-arkive-amber/40 sm:w-56"
              />
              <button
                type="button"
                onClick={() => void createFolder()}
                className="rounded-lg border border-arkive-border px-3 py-2 text-sm hover:border-arkive-amber/40"
              >
                New folder
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-lg bg-gradient-to-r from-arkive-orange to-arkive-amber px-3 py-2 text-sm font-semibold text-black"
              >
                Upload
              </button>
              {!sharedBrowse && (
                <button
                  type="button"
                  onClick={() => setShowTrash((v) => !v)}
                  className="rounded-lg border border-arkive-border px-3 py-2 text-sm hover:border-arkive-amber/40"
                >
                  Trash{trash.length ? ` (${trash.length})` : ''}
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => void onUpload(e.target.files)}
              />
            </div>
          )}
        </div>

        {view?.kind === 'shared' ? (
          <ul className="divide-y divide-arkive-border overflow-hidden rounded-2xl border border-arkive-border bg-arkive-surface/70">
            {shared.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-arkive-muted">
                Nothing shared with you yet.
              </li>
            )}
            {shared.map((node) => (
              <li key={node.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <button
                  type="button"
                  className="min-w-0 truncate text-left font-medium hover:text-arkive-amber"
                  onClick={() => {
                    if (node.kind === 'folder') {
                      setView({
                        kind: 'shared-folder',
                        workspaceId: node.workspace_id,
                        rootId: node.id,
                        parentId: node.id,
                      });
                      setParentId(node.id);
                    } else if (isPreviewable(node)) setPreviewNode(node);
                    else window.open(downloadUrl(node.id), '_blank');
                  }}
                >
                  {node.name}
                </button>
                {node.kind === 'file' && (
                  <a href={downloadUrl(node.id)} className="shrink-0 text-arkive-amber hover:underline">
                    Download
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : view?.kind === 'recent' ? (
          <ul className="divide-y divide-arkive-border overflow-hidden rounded-2xl border border-arkive-border bg-arkive-surface/70">
            {recent.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-arkive-muted">No recent activity.</li>
            )}
            {recent.map((ev) => (
              <li key={ev.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-arkive-panel/40"
                  onClick={() => {
                    if (ev.workspace_id) {
                      selectWorkspace(ev.workspace_id);
                      setParentId(ev.parent_id || null);
                    }
                  }}
                >
                  <span className="min-w-0 truncate font-medium">
                    {ev.node_name || ev.action}
                    <span className="ml-2 text-xs font-normal text-arkive-muted">{ev.action}</span>
                  </span>
                  <span className="shrink-0 text-xs text-arkive-muted">
                    {new Date(ev.created_at).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : view?.kind === 'live-drive' ? (
          <ul className="divide-y divide-arkive-border overflow-hidden rounded-2xl border border-arkive-border bg-arkive-surface/70">
            {view.parent !== 'root' && (
              <li className="px-4 py-2 text-sm">
                <button
                  type="button"
                  className="text-arkive-amber hover:underline"
                  onClick={() => setView({ kind: 'live-drive', parent: 'root' })}
                >
                  ← Drive root
                </button>
              </li>
            )}
            {liveItems.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-arkive-muted">
                Empty, or connect Google Drive in Account (live browse needs Drive access).
              </li>
            )}
            {liveItems.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <button
                  type="button"
                  className="min-w-0 truncate text-left font-medium hover:text-arkive-amber"
                  onClick={() => {
                    if (item.kind === 'folder') setView({ kind: 'live-drive', parent: item.id });
                    else window.open(api.liveDriveDownloadUrl(item.id), '_blank');
                  }}
                >
                  {item.name}
                </button>
                <span className="text-xs text-arkive-muted">
                  {item.kind === 'folder' ? 'Folder' : formatBytes(item.size)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <>
            {selected.size > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-arkive-border bg-arkive-panel/50 px-3 py-2 text-sm">
                <span className="text-arkive-muted">{selected.size} selected</span>
                <button
                  type="button"
                  onClick={() => setShowMove(true)}
                  className="rounded-md border border-arkive-border px-2 py-1 hover:border-arkive-amber/40"
                >
                  Move
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
                  className="rounded px-1.5 py-0.5 hover:bg-arkive-panel hover:text-arkive-text"
                >
                  Root
                </button>
                {breadcrumbs.map((b) => (
                  <span key={b.id} className="flex items-center gap-1">
                    <span>/</span>
                    <button
                      type="button"
                      onClick={() => setParentId(b.id)}
                      className="rounded px-1.5 py-0.5 hover:bg-arkive-panel hover:text-arkive-text"
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

            <ul className="divide-y divide-arkive-border overflow-hidden rounded-2xl border border-arkive-border bg-arkive-surface/70">
              <AnimatePresence initial={false}>
                {list.map((node, i) => (
                  <motion.li
                    key={node.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: Math.min(i * 0.03, 0.24), duration: 0.25 }}
                    className={`flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-arkive-panel/40 ${
                      selected.has(node.id) ? 'bg-arkive-amber/5' : ''
                    }`}
                  >
                    {!results && (
                      <input
                        type="checkbox"
                        checked={selected.has(node.id)}
                        onChange={() => undefined}
                        onClick={(e) => toggleSelect(node.id, e)}
                        className="h-4 w-4 accent-arkive-amber"
                      />
                    )}
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() => {
                        if (results) {
                          setParentId(node.parent_id || null);
                          setQuery('');
                          setResults(null);
                          if (node.kind === 'file' && isPreviewable(node)) setPreviewNode(node);
                          return;
                        }
                        openNode(node);
                      }}
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-xs font-bold ${
                          node.kind === 'folder'
                            ? 'border-arkive-amber/40 text-arkive-amber'
                            : 'border-arkive-border text-arkive-muted'
                        }`}
                      >
                        {node.kind === 'folder' ? 'DIR' : 'FILE'}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{node.name}</span>
                        <span className="text-xs text-arkive-muted">
                          {node.kind === 'file' ? formatBytes(node.size) : 'Folder'}
                        </span>
                      </span>
                    </button>
                    <div className="flex gap-1 text-xs">
                      {node.kind === 'file' && isPreviewable(node) && (
                        <button
                          type="button"
                          onClick={() => setPreviewNode(node)}
                          className="rounded-md px-2 py-1 text-arkive-muted hover:bg-arkive-panel hover:text-arkive-text"
                        >
                          Preview
                        </button>
                      )}
                      {node.kind === 'file' && (
                        <button
                          type="button"
                          onClick={() => setHistoryNode(node)}
                          className="rounded-md px-2 py-1 text-arkive-muted hover:bg-arkive-panel hover:text-arkive-text"
                        >
                          History
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShareNode(node)}
                        className="rounded-md px-2 py-1 text-arkive-muted hover:bg-arkive-panel hover:text-arkive-text"
                      >
                        Share
                      </button>
                      <button
                        type="button"
                        onClick={() => void renameNode(node)}
                        className="rounded-md px-2 py-1 text-arkive-muted hover:bg-arkive-panel hover:text-arkive-text"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deleteNode(node);
                        }}
                        className="rounded-md px-2 py-1 text-arkive-muted hover:bg-arkive-panel hover:text-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
              {list.length === 0 && (
                <li className="px-4 py-10 text-center text-sm text-arkive-muted">
                  {results
                    ? 'No matches.'
                    : 'This folder is empty. Drop files here or create a folder.'}
                </li>
              )}
            </ul>

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

      {shareNode && (
        <SharePanel
          nodeId={shareNode.id}
          nodeName={shareNode.name}
          workspaces={workspaces.filter((w) => w.type !== 'mount')}
          onClose={() => setShareNode(null)}
        />
      )}
      {previewNode && <PreviewModal node={previewNode} onClose={() => setPreviewNode(null)} />}
      {historyNode && <VersionsPanel node={historyNode} onClose={() => setHistoryNode(null)} />}
      {showMove && selectedNodes.length > 0 && workspaceId && (
        <MoveDialog
          workspaceId={workspaceId}
          workspaces={workspaces}
          nodes={selectedNodes}
          onClose={() => setShowMove(false)}
          onMoved={() => void loadNodes()}
        />
      )}
      {confirmDialog}
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
