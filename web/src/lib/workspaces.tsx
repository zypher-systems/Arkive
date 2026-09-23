import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type StorageConnection, type Workspace } from './api';
import { useInstance } from './instance';

export type Usage = { bytes: number; files: number; quota: number | null };

type WorkspacesState = {
  workspaces: Workspace[];
  loaded: boolean;
  personal?: Workspace;
  teams: Workspace[];
  mounts: Workspace[];
  usage: Usage | null;
  sharedCount: number;
  connections: StorageConnection[];
  /** Live Google Drive browsing is available (configured + connected). */
  liveDrive: boolean;
  refresh: () => Promise<void>;
  refreshUsage: () => Promise<void>;
  refreshShared: () => Promise<void>;
};

const Ctx = createContext<WorkspacesState | null>(null);

export function WorkspacesProvider({ children }: { children: ReactNode }) {
  const { info } = useInstance();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [sharedCount, setSharedCount] = useState(0);
  const [connections, setConnections] = useState<StorageConnection[]>([]);
  const mounted = useRef(true);

  const refreshUsage = useCallback(async () => {
    try {
      const u = await api.storageUsage();
      if (mounted.current) setUsage({ bytes: u.bytes, files: u.files, quota: u.quota_bytes ?? null });
    } catch {
      /* ignore */
    }
  }, []);

  const refreshShared = useCallback(async () => {
    try {
      const s = await api.sharedWithMe();
      if (mounted.current) setSharedCount(s.length);
    } catch {
      /* ignore */
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [ws, conns] = await Promise.all([
        api.workspaces(),
        api.storageConnections().catch(() => [] as StorageConnection[]),
      ]);
      if (!mounted.current) return;
      setWorkspaces(ws);
      setConnections(conns);
    } finally {
      if (mounted.current) setLoaded(true);
    }
    void refreshUsage();
    void refreshShared();
  }, [refreshUsage, refreshShared]);

  useEffect(() => {
    mounted.current = true;
    void refresh().catch(() => undefined);
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const value = useMemo<WorkspacesState>(() => {
    const personal = workspaces.find((w) => w.type === 'personal');
    return {
      workspaces,
      loaded,
      personal,
      teams: workspaces.filter((w) => w.type === 'team'),
      mounts: workspaces.filter((w) => w.type === 'mount'),
      usage,
      sharedCount,
      connections,
      liveDrive: !!info?.google_drive_enabled && connections.some((c) => c.type === 'gdrive'),
      refresh,
      refreshUsage,
      refreshShared,
    };
  }, [workspaces, loaded, usage, sharedCount, connections, info?.google_drive_enabled, refresh, refreshUsage, refreshShared]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspaces() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWorkspaces outside provider');
  return ctx;
}
