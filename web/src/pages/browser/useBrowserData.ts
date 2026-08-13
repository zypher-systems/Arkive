import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import {
  api,
  type Breadcrumb,
  type LiveDriveItem,
  type Node,
  type RecentItem,
  type Workspace,
} from '../../lib/api';
import type { ToastState } from '../../components/Toast';
import type { NavView } from './types';

function ignoreAbort(e: unknown) {
  return (
    !(e instanceof DOMException && e.name === 'AbortError') &&
    !(e instanceof Error && e.name === 'AbortError')
  );
}

export type UseBrowserDataParams = {
  query: string;
  setError: (message: string) => void;
  setSelected: (ids: Set<string>) => void;
  setToast: (toast: ToastState) => void;
  toastTimer: MutableRefObject<number | null>;
};

export function useBrowserData({
  query,
  setError,
  setSelected,
  setToast,
  toastTimer,
}: UseBrowserDataParams) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [view, setView] = useState<NavView | null>(null);
  const [parentId, setParentId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [shared, setShared] = useState<Node[]>([]);
  const [trash, setTrash] = useState<Node[]>([]);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [liveItems, setLiveItems] = useState<LiveDriveItem[]>([]);
  const [results, setResults] = useState<Node[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [rootBytes, setRootBytes] = useState<number | null>(null);
  const [rootQuota, setRootQuota] = useState<number | null>(null);
  const [totalBytes, setTotalBytes] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [totalQuota, setTotalQuota] = useState<number | null>(null);
  const warnedQuota = useRef(false);
  const searchTimer = useRef<number | null>(null);

  const workspaceId =
    view?.kind === 'workspace'
      ? view.id
      : view?.kind === 'shared-folder'
        ? view.workspaceId
        : '';

  const refreshUsage = useCallback(async () => {
    try {
      const total = await api.storageUsage();
      setTotalBytes(total.bytes);
      setTotalFiles(total.files);
      setTotalQuota(total.quota_bytes ?? null);
      if (
        total.quota_bytes != null &&
        total.quota_bytes > 0 &&
        total.bytes / total.quota_bytes >= 0.9 &&
        !warnedQuota.current
      ) {
        warnedQuota.current = true;
        if (toastTimer.current) window.clearTimeout(toastTimer.current);
        setToast({ id: Date.now(), message: 'Storage is over 90% of your quota' });
        toastTimer.current = window.setTimeout(() => setToast(null), 6000);
      }
    } catch {
      /* ignore */
    }
  }, [setToast, toastTimer]);

  const refreshRootUsage = useCallback(async (wsId: string) => {
    try {
      const u = await api.workspaceUsage(wsId);
      setRootBytes(u.bytes);
      setRootQuota(u.quota_bytes ?? null);
    } catch {
      setRootBytes(null);
      setRootQuota(null);
    }
  }, []);

  const loadWorkspaces = useCallback(async () => {
    const list = await api.workspaces();
    setWorkspaces(list);
    setView((prev) => {
      if (
        prev?.kind === 'shared' ||
        prev?.kind === 'shared-folder' ||
        prev?.kind === 'recent' ||
        prev?.kind === 'live-drive'
      ) {
        return prev;
      }
      if (prev?.kind === 'workspace' && list.some((w) => w.id === prev.id)) return prev;
      const personalId = list.find((w) => w.type === 'personal')?.id;
      const fallback = personalId || list.find((w) => w.type !== 'mount')?.id || list[0]?.id;
      return fallback ? { kind: 'workspace', id: fallback } : null;
    });
    await refreshUsage();
  }, [refreshUsage]);

  const loadNodes = useCallback(
    async (signal?: AbortSignal) => {
      const init = signal ? { signal } : undefined;
      setLoading(true);
      try {
      setShared(await api.sharedWithMe(init));
      setRecent(await api.recentActivity(init).catch(() => [] as RecentItem[]));
      if (view?.kind === 'live-drive') {
        const data = await api.liveDriveList(
          view.parent === 'root' ? undefined : view.parent,
          init,
        );
        setLiveItems(data.items);
        return;
      }
      if (!workspaceId) {
        setNodes([]);
        setBreadcrumbs([]);
        setTrash([]);
        setRootBytes(null);
        return;
      }
      const listParent =
        view?.kind === 'shared-folder' ? (parentId ?? view.rootId) : parentId;
      const data = await api.listNodes(workspaceId, listParent, init);
      setNodes(data.nodes);
      setBreadcrumbs(data.breadcrumbs);
      if (view?.kind === 'workspace') {
        setTrash(await api.trash(workspaceId, init));
        await refreshRootUsage(workspaceId);
      } else {
        setTrash([]);
        setRootBytes(null);
      }
      setSelected(new Set());
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [workspaceId, parentId, view, refreshRootUsage, setSelected],
  );

  useEffect(() => {
    void loadWorkspaces().catch((e) => setError(String(e)));
  }, [loadWorkspaces, setError]);

  useEffect(() => {
    const ctrl = new AbortController();
    const { signal } = ctrl;

    if (view?.kind === 'shared' || view?.kind === 'recent') {
      void Promise.all([
        api.sharedWithMe({ signal }),
        api.recentActivity({ signal }).catch(() => [] as RecentItem[]),
      ])
        .then(([s, r]) => {
          if (signal.aborted) return;
          setShared(s);
          setRecent(r);
        })
        .catch((e) => {
          if (ignoreAbort(e)) setError(e instanceof Error ? e.message : 'Load failed');
        });
      return () => ctrl.abort();
    }
    void loadNodes(signal).catch((e) => {
      if (ignoreAbort(e)) setError(e instanceof Error ? e.message : 'Load failed');
    });
    return () => ctrl.abort();
  }, [loadNodes, view?.kind, setError]);

  useEffect(() => {
    if (!workspaceId || view?.kind !== 'workspace') return;
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    if (!query.trim()) {
      setResults(null);
      return;
    }
    const ctrl = new AbortController();
    searchTimer.current = window.setTimeout(() => {
      void api
        .searchAll(query.trim(), { signal: ctrl.signal })
        .then((r) => {
          if (!ctrl.signal.aborted) setResults(r);
        })
        .catch((e) => {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          if (e instanceof Error && e.name === 'AbortError') return;
          setError(e instanceof Error ? e.message : 'Search failed');
        });
    }, 250);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
      ctrl.abort();
    };
  }, [query, workspaceId, view?.kind, setError]);

  return {
    workspaces,
    setWorkspaces,
    view,
    setView,
    parentId,
    setParentId,
    nodes,
    setNodes,
    breadcrumbs,
    setBreadcrumbs,
    shared,
    setShared,
    trash,
    setTrash,
    recent,
    setRecent,
    liveItems,
    setLiveItems,
    results,
    setResults,
    loading,
    rootBytes,
    rootQuota,
    totalBytes,
    totalFiles,
    totalQuota,
    workspaceId,
    loadWorkspaces,
    loadNodes,
    refreshUsage,
    refreshRootUsage,
  };
}
