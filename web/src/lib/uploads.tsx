import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { api, ApiError } from './api';
import { baseOf, dirOf } from './paths';
import { RateMeter, eta as etaOf } from './rate';
import {
  DEFAULT_CHUNK_SIZE,
  TusError,
  TusUpload,
  browserStorage,
  resumeKey,
  xhrTransport,
} from './tus';
import type { PickedFile } from './dropFiles';
import { t } from '../i18n';

/** Files above this go through tus (contract §1); smaller ones use a single PUT. */
export const TUS_THRESHOLD = 8 * 1024 * 1024;
export const PARALLEL_UPLOADS = 3;

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error' | 'canceled';

export type UploadTarget = {
  workspaceId: string;
  parentId: string | null;
  /** Human label of the destination folder (for the queue panel). */
  label: string;
};

export type UploadItem = {
  id: string;
  batchId: string;
  file: File;
  name: string;
  /** Folder path inside the drop, e.g. "Photos/2024" ('' for loose files). */
  dir: string;
  target: UploadTarget;
  size: number;
  sent: number;
  status: UploadStatus;
  error?: string;
  method?: 'tus' | 'put';
  resumed?: boolean;
  rate: number;
  eta: number | null;
  /** Parent folder the file actually landed in (after folder creation). */
  landedParentId?: string | null;
};

/** An upload from a previous page load that can be resumed by re-picking the file. */
export type InterruptedUpload = {
  key: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  size: number;
  lastModified: number;
};

export type UploadedEvent = { workspaceId: string; parentId: string | null; nodeId?: string | null };

type Snapshot = { items: UploadItem[]; interrupted: InterruptedUpload[]; version: number };

const UUID = '[0-9a-fA-F-]{36}';
const RESUME_RE = new RegExp(`^arkive\\.tus\\.(${UUID})\\.(${UUID})?\\.(.+)\\.(\\d+)\\.(\\d+)$`);

export function parseResumeKey(key: string): InterruptedUpload | null {
  const m = RESUME_RE.exec(key);
  if (!m) return null;
  return {
    key,
    workspaceId: m[1],
    parentId: m[2] || null,
    name: m[3],
    size: Number(m[4]),
    lastModified: Number(m[5]),
  };
}

let seq = 0;
const uid = () => `u${Date.now().toString(36)}${(++seq).toString(36)}`;

/**
 * Framework-free upload queue: 3 concurrent transfers, tus for large files
 * (with PUT fallback when the server lacks tus), folder creation for folder
 * uploads, per-item cancel/retry. React subscribes via useSyncExternalStore.
 */
export class UploadEngine {
  private items = new Map<string, UploadItem>();
  private order: string[] = [];
  private running = new Map<string, { abort: () => void }>();
  private meters = new Map<string, RateMeter>();
  private folderCache = new Map<string, Promise<string>>();
  private listeners = new Set<() => void>();
  private uploadedListeners = new Set<(e: UploadedEvent) => void>();
  private snapshot: Snapshot = { items: [], interrupted: [], version: 0 };
  private notifyTimer: number | null = null;
  private tusSupported: boolean | null = null;
  private storage = typeof window !== 'undefined' ? browserStorage() : null;

  constructor() {
    this.snapshot = { items: [], interrupted: this.scanInterrupted(), version: 0 };
  }

  private scanInterrupted(): InterruptedUpload[] {
    if (!this.storage) return [];
    const out: InterruptedUpload[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith('arkive.tus.')) continue;
        const parsed = parseResumeKey(k);
        if (parsed) out.push(parsed);
      }
    } catch {
      /* ignore */
    }
    return out;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snapshot;

  onUploaded(fn: (e: UploadedEvent) => void) {
    this.uploadedListeners.add(fn);
    return () => {
      this.uploadedListeners.delete(fn);
    };
  }

  private emit(immediate = false) {
    const flush = () => {
      this.notifyTimer = null;
      this.snapshot = {
        items: this.order.map((id) => ({ ...this.items.get(id)! })),
        interrupted: this.snapshot.interrupted,
        version: this.snapshot.version + 1,
      };
      for (const l of this.listeners) l();
    };
    if (immediate) {
      if (this.notifyTimer) window.clearTimeout(this.notifyTimer);
      flush();
    } else if (!this.notifyTimer) {
      this.notifyTimer = window.setTimeout(flush, 120);
    }
  }

  enqueue(files: PickedFile[], target: UploadTarget) {
    const batchId = uid();
    for (const { file, relPath } of files) {
      const id = uid();
      this.items.set(id, {
        id,
        batchId,
        file,
        name: baseOf(relPath) || file.name,
        dir: dirOf(relPath),
        target,
        size: file.size,
        sent: 0,
        status: 'queued',
        rate: 0,
        eta: null,
      });
      this.order.push(id);
    }
    // Picking a previously interrupted file again resumes it — drop the hint.
    const names = new Set(files.map((f) => `${f.file.name}.${f.file.size}`));
    this.snapshot = {
      ...this.snapshot,
      interrupted: this.snapshot.interrupted.filter((u) => !names.has(`${u.name}.${u.size}`)),
    };
    this.emit(true);
    this.pump();
    return batchId;
  }

  dismissInterrupted(key: string) {
    try {
      this.storage?.removeItem(key);
    } catch {
      /* ignore */
    }
    this.snapshot = { ...this.snapshot, interrupted: this.snapshot.interrupted.filter((u) => u.key !== key) };
    this.emit(true);
  }

  cancel(id: string) {
    const item = this.items.get(id);
    if (!item) return;
    if (item.status === 'queued' || item.status === 'uploading') {
      this.running.get(id)?.abort();
      this.running.delete(id);
      this.patch(id, { status: 'canceled', rate: 0, eta: null }, true);
      this.pump();
    }
  }

  cancelAll() {
    for (const id of this.order) this.cancel(id);
  }

  retry(id: string) {
    const item = this.items.get(id);
    if (!item || (item.status !== 'error' && item.status !== 'canceled')) return;
    this.patch(id, { status: 'queued', error: undefined, sent: 0 }, true);
    this.pump();
  }

  retryFailed() {
    for (const id of this.order) {
      if (this.items.get(id)?.status === 'error') this.retry(id);
    }
  }

  clearFinished() {
    this.order = this.order.filter((id) => {
      const s = this.items.get(id)?.status;
      const keep = s === 'queued' || s === 'uploading';
      if (!keep) this.items.delete(id);
      return keep;
    });
    this.emit(true);
  }

  private patch(id: string, p: Partial<UploadItem>, immediate = false) {
    const cur = this.items.get(id);
    if (!cur) return;
    this.items.set(id, { ...cur, ...p });
    this.emit(immediate);
  }

  private pump() {
    const active = [...this.items.values()].filter((i) => i.status === 'uploading').length;
    let slots = PARALLEL_UPLOADS - active;
    for (const id of this.order) {
      if (slots <= 0) break;
      const item = this.items.get(id);
      if (item?.status !== 'queued') continue;
      slots--;
      void this.run(id);
    }
    if (active === 0 && ![...this.items.values()].some((i) => i.status === 'queued')) {
      // Queue drained: folder ids may go stale (renames/deletes), forget them.
      this.folderCache.clear();
    }
  }

  /** Create (or reuse) the nested folder `dir` under the target; returns its id. */
  private ensureFolder(target: UploadTarget, dir: string): Promise<string | null> {
    if (!dir) return Promise.resolve(target.parentId);
    const parts = dir.split('/').filter(Boolean);
    let chain: Promise<string | null> = Promise.resolve(target.parentId);
    let path = '';
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      const key = `${target.workspaceId}|${target.parentId || ''}|${path}`;
      const prev = chain;
      let p = this.folderCache.get(key);
      if (!p) {
        p = prev.then(async (parent) => {
          try {
            const node = await api.mkdir(target.workspaceId, part, parent);
            return node.id;
          } catch (e) {
            if (e instanceof ApiError && e.status === 409) {
              const { nodes } = await api.listNodes(target.workspaceId, parent);
              const existing = nodes.find((n) => n.kind === 'folder' && n.name === part);
              if (existing) return existing.id;
            }
            throw e;
          }
        });
        this.folderCache.set(key, p);
        p.catch(() => this.folderCache.delete(key));
      }
      chain = p;
    }
    return chain;
  }

  private async run(id: string) {
    const item = this.items.get(id);
    if (!item) return;
    const controller = new AbortController();
    let tus: TusUpload | null = null;
    this.running.set(id, {
      abort: () => {
        controller.abort();
        void tus?.abort(true);
      },
    });
    const meter = new RateMeter();
    this.meters.set(id, meter);
    this.patch(id, { status: 'uploading', sent: 0, rate: 0, eta: null }, true);

    const onProgress = (sent: number) => {
      const now = performance.now();
      meter.push(now, sent);
      const rate = meter.rate();
      this.patch(id, { sent, rate, eta: etaOf(item.size - sent, rate) });
    };

    try {
      const parentId = await this.ensureFolder(item.target, item.dir);
      if (controller.signal.aborted) return;
      let nodeId: string | null | undefined;
      const useTus = item.size > TUS_THRESHOLD && this.tusSupported !== false;
      if (useTus) {
        try {
          tus = new TusUpload(item.file, {
            endpoint: '/api/uploads',
            metadata: {
              workspace_id: item.target.workspaceId,
              // Omitted for the workspace root (contract: empty = root).
              parent_id: parentId || undefined,
              filename: item.name,
              content_type: item.file.type || 'application/octet-stream',
            },
            transport: xhrTransport,
            chunkSize: DEFAULT_CHUNK_SIZE,
            storage: this.storage,
            storageKey: resumeKey({
              workspaceId: item.target.workspaceId,
              parentId,
              name: item.name,
              size: item.size,
              lastModified: item.file.lastModified,
            }),
            onProgress,
          });
          this.patch(id, { method: 'tus' });
          const res = await tus.start();
          this.tusSupported = true;
          nodeId = res.nodeId;
          if (tus.resumed) this.patch(id, { resumed: true });
        } catch (e) {
          if (e instanceof TusError && e.code === 'unsupported') {
            this.tusSupported = false;
            tus = null;
          } else {
            throw e;
          }
        }
      }
      if (!useTus || this.tusSupported === false) {
        if (nodeId === undefined) {
          this.patch(id, { method: 'put' });
          const node = await api.upload(item.target.workspaceId, item.file, parentId, {
            name: item.name,
            signal: controller.signal,
            onProgress: (loaded) => onProgress(loaded),
          });
          nodeId = node?.id;
        }
      }
      this.patch(id, { status: 'done', sent: item.size, rate: 0, eta: 0, landedParentId: parentId }, true);
      for (const l of this.uploadedListeners) l({ workspaceId: item.target.workspaceId, parentId, nodeId });
      // A folder upload also changes the target folder listing (new subfolder).
      if (item.dir && parentId !== item.target.parentId) {
        for (const l of this.uploadedListeners) l({ workspaceId: item.target.workspaceId, parentId: item.target.parentId });
      }
    } catch (e) {
      const current = this.items.get(id);
      if (current?.status === 'canceled' || controller.signal.aborted) return;
      const offline = (e instanceof ApiError || e instanceof TusError) && e.status === 0;
      const msg = offline
        ? t('errors.network')
        : e instanceof Error && e.name !== 'AbortError' && e.message
          ? e.message
          : t('upload.failed');
      this.patch(id, { status: 'error', error: msg, rate: 0, eta: null }, true);
    } finally {
      this.running.delete(id);
      this.meters.delete(id);
      this.pump();
    }
  }
}

export type UploadStats = {
  total: number;
  done: number;
  failed: number;
  canceled: number;
  active: number;
  queued: number;
  bytesTotal: number;
  bytesSent: number;
  rate: number;
  eta: number | null;
};

export function uploadStats(items: readonly UploadItem[]): UploadStats {
  const s: UploadStats = {
    total: items.length,
    done: 0,
    failed: 0,
    canceled: 0,
    active: 0,
    queued: 0,
    bytesTotal: 0,
    bytesSent: 0,
    rate: 0,
    eta: null,
  };
  for (const i of items) {
    if (i.status === 'canceled') {
      s.canceled++;
      continue;
    }
    s.bytesTotal += i.size;
    s.bytesSent += i.status === 'done' ? i.size : i.sent;
    if (i.status === 'done') s.done++;
    else if (i.status === 'error') s.failed++;
    else if (i.status === 'uploading') {
      s.active++;
      s.rate += i.rate;
    } else if (i.status === 'queued') s.queued++;
  }
  const remaining = items
    .filter((i) => i.status === 'uploading' || i.status === 'queued')
    .reduce((acc, i) => acc + (i.size - i.sent), 0);
  s.eta = etaOf(remaining, s.rate);
  return s;
}

/** The folder the user is looking at, registered by the file browser. */
export type ActiveFolder = {
  target: UploadTarget;
  /** The folder is visible but the user may not write to it. */
  readOnly?: boolean;
  newFolder?: () => void;
  newFile?: (ext: '.txt' | '.md') => void;
};

type UploadsCtx = {
  engine: UploadEngine;
  /** Where uploads from the top bar / a window drop go (null → not writable). */
  activeFolder: ActiveFolder | null;
  setActiveFolder: (f: ActiveFolder | null) => void;
};

const UploadsContext = createContext<UploadsCtx | null>(null);

export function UploadsProvider({ children }: { children: ReactNode }) {
  const [engine] = useState(() => new UploadEngine());
  const [activeFolder, setActiveFolder] = useState<ActiveFolder | null>(null);
  const value = useMemo(() => ({ engine, activeFolder, setActiveFolder }), [engine, activeFolder]);

  // Warn before leaving while transfers are running.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      const busy = engine.getSnapshot().items.some((i) => i.status === 'uploading' || i.status === 'queued');
      if (busy) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [engine]);

  return <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>;
}

export function useUploads() {
  const ctx = useContext(UploadsContext);
  if (!ctx) throw new Error('useUploads outside UploadsProvider');
  const snap = useSyncExternalStore(ctx.engine.subscribe, ctx.engine.getSnapshot);
  return { ...ctx, items: snap.items, interrupted: snap.interrupted };
}

/** Engine + drop target without subscribing to progress (cheap for most components). */
export function useUploadEngine() {
  const ctx = useContext(UploadsContext);
  if (!ctx) throw new Error('useUploadEngine outside UploadsProvider');
  return ctx;
}
