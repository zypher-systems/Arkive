/**
 * Minimal tus 1.0.0 client (creation + termination, resumable across page
 * reloads). Written in-house instead of pulling in tus-js-client (~40 KB
 * min) because Arkive only needs the core protocol against its own server,
 * and a transport-injected class is trivially unit-testable.
 *
 * Contract: CONTRACTS.md §1.
 */

export const TUS_VERSION = '1.0.0';
export const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;

export type TusTransportRequest = {
  method: 'POST' | 'HEAD' | 'PATCH' | 'DELETE' | 'OPTIONS';
  url: string;
  headers: Record<string, string>;
  body?: Blob;
  onProgress?: (loaded: number) => void;
  signal?: AbortSignal;
};

export type TusTransportResponse = {
  status: number;
  header: (name: string) => string | null;
  /** Response body (used to surface `{ "error": "…" }` messages). */
  text?: string;
};

function serverMessage(res: TusTransportResponse, fallback: string) {
  if (res.text) {
    try {
      const data = JSON.parse(res.text) as { error?: string };
      if (data?.error) return data.error;
    } catch {
      /* not JSON */
    }
  }
  return fallback;
}

/** Performs one HTTP request. Rejects only on network failure / abort. */
export type TusTransport = (req: TusTransportRequest) => Promise<TusTransportResponse>;

export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** The subset of `File` the client needs (lets tests use plain objects). */
export type TusFile = {
  name: string;
  size: number;
  type?: string;
  lastModified?: number;
  slice(start: number, end: number): Blob;
};

export type TusState = 'idle' | 'uploading' | 'done' | 'error' | 'aborted';

export class TusError extends Error {
  status: number;
  /** `unsupported` → the server has no tus endpoint; caller should fall back. */
  code: 'http' | 'unsupported' | 'aborted' | 'protocol';
  constructor(message: string, status: number, code: TusError['code'] = 'http') {
    super(message);
    this.name = 'TusError';
    this.status = status;
    this.code = code;
  }
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** tus `Upload-Metadata`: comma-separated `key base64(value)` pairs. */
export function encodeMetadata(meta: Record<string, string | null | undefined>): string {
  return Object.entries(meta)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => (v === '' ? k : `${k} ${utf8ToBase64(String(v))}`))
    .join(',');
}

/** localStorage key used to resume an upload after a reload (contract §1). */
export function resumeKey(p: {
  workspaceId: string;
  parentId?: string | null;
  name: string;
  size: number;
  lastModified?: number;
}): string {
  return `arkive.tus.${p.workspaceId}.${p.parentId || ''}.${p.name}.${p.size}.${p.lastModified ?? 0}`;
}

/** Resolve a `Location` header against the endpoint, keeping same-origin URLs path-only. */
export function resolveUrl(location: string, base: string): string {
  if (/^https?:\/\//i.test(location)) {
    if (typeof window !== 'undefined' && window.location) {
      const u = new URL(location);
      if (u.origin === window.location.origin) return u.pathname + u.search;
    }
    return location;
  }
  if (location.startsWith('/')) return location;
  const u = new URL(location, `http://placeholder${base.startsWith('/') ? base : `/${base}`}`);
  return u.pathname + u.search;
}

export type TusUploadOptions = {
  endpoint: string;
  metadata: Record<string, string | null | undefined>;
  transport: TusTransport;
  chunkSize?: number;
  storage?: KeyValueStore | null;
  storageKey?: string;
  onProgress?: (sent: number, total: number) => void;
  /** Backoff between retries of a failed chunk (ms). Length = max retries. */
  retryDelays?: number[];
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class TusUpload {
  readonly file: TusFile;
  readonly opts: Required<Omit<TusUploadOptions, 'storage' | 'storageKey' | 'onProgress'>> &
    Pick<TusUploadOptions, 'storage' | 'storageKey' | 'onProgress'>;
  state: TusState = 'idle';
  url: string | null = null;
  offset = 0;
  /** Whether the current run resumed a session saved by an earlier page. */
  resumed = false;
  private controller: AbortController | null = null;

  constructor(file: TusFile, opts: TusUploadOptions) {
    this.file = file;
    this.opts = {
      chunkSize: DEFAULT_CHUNK_SIZE,
      retryDelays: [0, 1000, 3000, 5000],
      sleep: defaultSleep,
      ...opts,
    };
  }

  private headers(extra: Record<string, string> = {}) {
    return { 'Tus-Resumable': TUS_VERSION, ...extra };
  }

  private async send(req: Omit<TusTransportRequest, 'signal'>) {
    if (this.state === 'aborted') throw new TusError('Upload aborted', 0, 'aborted');
    this.controller = new AbortController();
    try {
      return await this.opts.transport({ ...req, signal: this.controller.signal });
    } catch (e) {
      if (this.isAborted()) throw new TusError('Upload aborted', 0, 'aborted');
      throw e;
    } finally {
      this.controller = null;
    }
  }

  /** Read through a method so TS doesn't narrow away concurrent abort(). */
  private isAborted() {
    return (this.state as TusState) === 'aborted';
  }

  private saveUrl() {
    if (this.opts.storage && this.opts.storageKey && this.url) {
      try {
        this.opts.storage.setItem(this.opts.storageKey, this.url);
      } catch {
        /* storage full / disabled — resume just won't survive reloads */
      }
    }
  }

  private forgetUrl() {
    if (this.opts.storage && this.opts.storageKey) {
      try {
        this.opts.storage.removeItem(this.opts.storageKey);
      } catch {
        /* ignore */
      }
    }
  }

  /** HEAD the session; returns the server offset or null when it is gone. */
  private async fetchOffset(): Promise<number | null> {
    if (!this.url) return null;
    const res = await this.send({ method: 'HEAD', url: this.url, headers: this.headers() });
    if (res.status === 404 || res.status === 410 || res.status === 403) return null;
    if (res.status < 200 || res.status >= 300) {
      throw new TusError(`HEAD failed (${res.status})`, res.status);
    }
    const off = Number(res.header('Upload-Offset'));
    if (!Number.isFinite(off) || off < 0) throw new TusError('Missing Upload-Offset', res.status, 'protocol');
    return off;
  }

  private async create() {
    const res = await this.send({
      method: 'POST',
      url: this.opts.endpoint,
      headers: this.headers({
        'Upload-Length': String(this.file.size),
        'Upload-Metadata': encodeMetadata(this.opts.metadata),
      }),
    });
    if (res.status === 404 || res.status === 405 || res.status === 501) {
      throw new TusError('Resumable uploads are not supported by this server', res.status, 'unsupported');
    }
    if (res.status !== 201) {
      throw new TusError(serverMessage(res, `Could not start upload (${res.status})`), res.status);
    }
    const loc = res.header('Location');
    if (!loc) throw new TusError('Server did not return an upload URL', res.status, 'protocol');
    this.url = resolveUrl(loc, this.opts.endpoint);
    this.offset = 0;
    this.saveUrl();
  }

  /**
   * Run (or resume) the upload. Resolves with the created node id (from the
   * `Arkive-Node-Id` header on the final PATCH).
   */
  async start(): Promise<{ nodeId: string | null }> {
    if (this.state === 'uploading') throw new TusError('Already running', 0, 'protocol');
    this.state = 'uploading';
    try {
      // 1. Resume a session from a previous run / page load when possible.
      if (!this.url && this.opts.storage && this.opts.storageKey) {
        try {
          this.url = this.opts.storage.getItem(this.opts.storageKey);
        } catch {
          this.url = null;
        }
      }
      if (this.url) {
        const off = await this.fetchOffset().catch((e) => {
          if (e instanceof TusError && e.code === 'aborted') throw e;
          return null;
        });
        if (off === null) {
          this.forgetUrl();
          this.url = null;
        } else {
          this.offset = off;
          this.resumed = off > 0;
        }
      }
      // 2. Otherwise create a new session.
      if (!this.url) await this.create();
      this.opts.onProgress?.(this.offset, this.file.size);

      // 3. Stream chunks.
      let nodeId: string | null = null;
      let attempt = 0;
      let first = true;
      while (this.offset < this.file.size || (first && this.file.size === 0)) {
        first = false;
        const start = this.offset;
        const end = Math.min(start + this.opts.chunkSize, this.file.size);
        let res: TusTransportResponse;
        try {
          res = await this.send({
            method: 'PATCH',
            url: this.url!,
            headers: this.headers({
              'Upload-Offset': String(start),
              'Content-Type': 'application/offset+octet-stream',
            }),
            body: this.file.slice(start, end),
            onProgress: (loaded) => this.opts.onProgress?.(start + loaded, this.file.size),
          });
        } catch (e) {
          if (e instanceof TusError && e.code === 'aborted') throw e;
          // Network error: back off, resync offset, retry.
          if (attempt >= this.opts.retryDelays.length) throw e instanceof Error ? e : new TusError('Network error', 0);
          await this.opts.sleep(this.opts.retryDelays[attempt++]);
          const off = await this.fetchOffset();
          if (off === null) throw new TusError('Upload session expired', 404);
          this.offset = off;
          continue;
        }

        if (res.status === 204 || res.status === 200) {
          const next = Number(res.header('Upload-Offset'));
          if (!Number.isFinite(next) || next < start) {
            throw new TusError('Invalid Upload-Offset in response', res.status, 'protocol');
          }
          this.offset = next;
          attempt = 0;
          const id = res.header('Arkive-Node-Id');
          if (id) nodeId = id;
          this.opts.onProgress?.(this.offset, this.file.size);
          continue;
        }
        if (res.status === 409) {
          // Offset mismatch — ask the server where it is and continue from there.
          const off = await this.fetchOffset();
          if (off === null) throw new TusError('Upload session expired', 404);
          this.offset = off;
          continue;
        }
        if (res.status >= 500 || res.status === 423 || res.status === 429) {
          if (attempt >= this.opts.retryDelays.length) throw new TusError(`Upload failed (${res.status})`, res.status);
          await this.opts.sleep(this.opts.retryDelays[attempt++]);
          const off = await this.fetchOffset();
          if (off === null) throw new TusError('Upload session expired', 404);
          this.offset = off;
          continue;
        }
        throw new TusError(serverMessage(res, `Upload failed (${res.status})`), res.status);
      }

      this.forgetUrl();
      this.state = 'done';
      return { nodeId };
    } catch (e) {
      if (!this.isAborted()) this.state = 'error';
      throw e;
    }
  }

  /** Stop the upload. With `terminate`, the partial data is deleted server side. */
  async abort(terminate = true) {
    const wasRunning = this.state === 'uploading';
    this.state = 'aborted';
    this.controller?.abort();
    if (terminate && this.url) {
      const url = this.url;
      this.url = null;
      this.forgetUrl();
      try {
        await this.opts.transport({ method: 'DELETE', url, headers: this.headers() });
      } catch {
        /* best effort; the server purges abandoned sessions */
      }
    }
    return wasRunning;
  }
}

/** Browser transport: XHR so PATCH bodies report upload progress. */
export const xhrTransport: TusTransport = (req) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(req.method, req.url);
    xhr.withCredentials = true;
    for (const [k, v] of Object.entries(req.headers)) xhr.setRequestHeader(k, v);
    if (req.onProgress) {
      xhr.upload.onprogress = (e) => req.onProgress?.(e.loaded);
    }
    const onAbort = () => xhr.abort();
    req.signal?.addEventListener('abort', onAbort, { once: true });
    xhr.onload = () => {
      req.signal?.removeEventListener('abort', onAbort);
      resolve({ status: xhr.status, header: (n) => xhr.getResponseHeader(n), text: xhr.responseText });
    };
    xhr.onerror = () => reject(new TusError('Network error', 0));
    xhr.onabort = () => reject(new TusError('Upload aborted', 0, 'aborted'));
    xhr.send(req.body ?? null);
  });

/** Safe localStorage accessor (null in private mode / SSR). */
export function browserStorage(): KeyValueStore | null {
  try {
    const k = '__arkive_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}
