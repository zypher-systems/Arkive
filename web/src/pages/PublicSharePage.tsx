import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import {
  AlertIcon,
  ArrowUpIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  InboxIcon,
  LinkIcon,
  LockIcon,
  RefreshIcon,
  UploadIcon,
} from '../components/icons';
import { Button, IconButton } from '../components/ui/Button';
import { EmptyState, ProgressBar } from '../components/ui/Card';
import { Field, Input } from '../components/ui/Input';
import { Notice } from '../components/ui/Notice';
import { Spinner } from '../components/ui/Spinner';
import { FileGlyph } from '../components/files/FileThumb';
import { api, ApiError, type Breadcrumb, type Node, type PublicMeta } from '../lib/api';
import { collectDrop, dragHasFiles, fromFileList, type PickedFile } from '../lib/dropFiles';
import { downloadBlob } from '../lib/hooks';
import { useI18n } from '../i18n';

type State =
  | { kind: 'loading' }
  | { kind: 'password'; error?: string }
  | { kind: 'error'; message: string; status?: number }
  | { kind: 'ready'; meta: PublicMeta };

/** Public link landing page: download view, folder browser, or upload-only drop page (§4). */
export function PublicSharePage() {
  const { t } = useI18n();
  const { token = '' } = useParams();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (pass?: string) => {
      try {
        const meta = await api.publicMeta(token, pass);
        if (pass) setUnlocked(pass);
        setState({ kind: 'ready', meta });
      } catch (err) {
        const e = err as ApiError;
        const data = e.data as { needs_password?: boolean } | undefined;
        if (e.status === 401 || data?.needs_password) {
          setState({ kind: 'password', error: pass ? t('public.wrongPassword') : undefined });
          return;
        }
        setState({ kind: 'error', message: e.message, status: e.status });
      }
    },
    [token, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function unlock(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await load(password);
    setBusy(false);
  }

  if (state.kind === 'loading') {
    return (
      <AuthLayout bare>
        <div className="flex justify-center py-16">
          <Spinner size={22} className="text-faint" />
        </div>
      </AuthLayout>
    );
  }

  if (state.kind === 'error') {
    const gone = state.status === 404 || state.status === 410 || state.status === 403;
    return (
      <AuthLayout>
        <EmptyState
          compact
          icon={<LinkIcon size={22} />}
          title={gone ? t('public.unavailableTitle') : t('public.errorTitle')}
          hint={gone ? t('public.unavailableHint') : state.message}
        />
      </AuthLayout>
    );
  }

  if (state.kind === 'password') {
    return (
      <AuthLayout title={t('public.protectedTitle')} subtitle={t('public.protectedSubtitle')}>
        <form onSubmit={unlock} className="space-y-4">
          <Field label={t('auth.password')}>
            {({ id }) => (
              <Input
                id={id}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="off"
                icon={<LockIcon size={15} />}
              />
            )}
          </Field>
          {state.error && <Notice kind="error">{state.error}</Notice>}
          <Button type="submit" variant="primary" size="lg" full loading={busy} disabled={!password}>
            {t('public.unlock')}
          </Button>
        </form>
      </AuthLayout>
    );
  }

  const { meta } = state;
  if (meta.mode === 'upload') return <UploadDrop token={token} meta={meta} password={unlocked} />;
  if (meta.kind === 'folder') return <FolderView token={token} meta={meta} password={unlocked} />;
  return <FileView token={token} meta={meta} password={unlocked} />;
}

function FileView({ token, meta, password }: { token: string; meta: PublicMeta; password?: string }) {
  const { t, formatBytes } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function download() {
    setBusy(true);
    setError('');
    try {
      const { blob, filename } = await api.publicDownload(token, undefined, password);
      downloadBlob(blob, meta.name || filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('public.downloadFailed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout subtitle={t('public.sharedFile')}>
      <div className="flex flex-col items-center text-center">
        <FileGlyph name={meta.name} mime={meta.mime} size={88} />
        <h1 className="mt-4 max-w-full text-lg font-semibold break-words text-ink">{meta.name}</h1>
        {meta.size != null && <p className="mt-1 text-sm text-muted">{formatBytes(meta.size)}</p>}
        <Button variant="accent" size="lg" className="mt-6 w-full" loading={busy} icon={<DownloadIcon size={16} />} onClick={() => void download()}>
          {t('common.download')}
        </Button>
        {error && <Notice kind="error" className="mt-4 w-full text-left">{error}</Notice>}
      </div>
    </AuthLayout>
  );
}

function FolderView({ token, meta, password }: { token: string; meta: PublicMeta; password?: string }) {
  const { t, formatBytes, formatModified } = useI18n();
  const [nodes, setNodes] = useState<Node[] | null>(null);
  const [crumbs, setCrumbs] = useState<Breadcrumb[]>([]);
  const [folderId, setFolderId] = useState<string>(meta.node_id);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const open = useCallback(
    async (id: string) => {
      setNodes(null);
      setError('');
      try {
        const data = await api.publicNodes(token, id, password);
        const sorted = [...data.nodes].sort((a, b) =>
          a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true }),
        );
        setNodes(sorted);
        setCrumbs(data.breadcrumbs);
        setFolderId(id);
      } catch (e) {
        setNodes([]);
        setError(e instanceof Error ? e.message : t('public.listFailed'));
      }
    },
    [token, password, t],
  );

  useEffect(() => {
    void open(meta.node_id);
  }, [open, meta.node_id]);

  async function downloadFile(n: Node) {
    setBusy(n.id);
    try {
      const { blob } = await api.publicDownload(token, n.id, password);
      downloadBlob(blob, n.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('public.downloadFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function downloadAll() {
    setBusy('zip');
    try {
      const { blob, filename } = await api.publicDownloadZip(token, [folderId], password);
      downloadBlob(blob, filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('public.downloadFailed'));
    } finally {
      setBusy(null);
    }
  }

  const rootIdx = crumbs.findIndex((c) => c.id === meta.node_id);
  const trail = rootIdx >= 0 ? crumbs.slice(rootIdx) : [{ id: meta.node_id, name: meta.name }];
  const atRoot = folderId === meta.node_id;

  return (
    <AuthLayout width="max-w-3xl" bare>
      <div className="panel overflow-hidden shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-4 sm:px-6">
          <FileGlyph name={meta.name} kind="folder" size={40} />
          <div className="min-w-[12rem] flex-1">
            <p className="text-xs font-medium text-muted">{t('public.sharedFolder')}</p>
            <nav aria-label={t('files.breadcrumbs')} className="flex min-w-0 flex-wrap items-center gap-0.5">
              {trail.map((c, i) => (
                <span key={c.id} className="flex min-w-0 items-center gap-0.5">
                  {i > 0 && <ChevronRightIcon size={14} className="shrink-0 text-faint" />}
                  {i === trail.length - 1 ? (
                    <h1 className="truncate text-lg font-semibold text-ink">{c.name}</h1>
                  ) : (
                    <button type="button" onClick={() => void open(c.id)} className="truncate rounded px-1 text-lg text-muted hover:bg-hover hover:text-ink">
                      {c.name}
                    </button>
                  )}
                </span>
              ))}
            </nav>
          </div>
          <div className="flex gap-2">
            {!atRoot && (
              <Button
                variant="secondary"
                icon={<ArrowUpIcon size={15} />}
                onClick={() => void open(trail.length > 1 ? trail[trail.length - 2].id : meta.node_id)}
              >
                {t('public.up')}
              </Button>
            )}
            <Button variant="accent" icon={<DownloadIcon size={15} />} loading={busy === 'zip'} onClick={() => void downloadAll()}>
              {t('public.downloadAll')}
            </Button>
          </div>
        </div>
        {error && <Notice kind="error" className="m-4">{error}</Notice>}
        {nodes === null ? (
          <div className="flex justify-center py-12">
            <Spinner className="text-faint" />
          </div>
        ) : nodes.length === 0 ? (
          <EmptyState compact icon={<InboxIcon size={20} />} title={t('public.emptyFolder')} />
        ) : (
          <ul className="divide-y divide-line">
            {nodes.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => (n.kind === 'folder' ? void open(n.id) : void downloadFile(n))}
                  className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-hover sm:px-6 coarse:py-3.5"
                >
                  <FileGlyph name={n.name} kind={n.kind} mime={n.mime} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-medium text-ink">{n.name}</span>
                    <span className="block text-xs text-muted">
                      {n.kind === 'folder' ? t('files.folder') : `${formatBytes(n.size)} · ${formatModified(n.updated_at)}`}
                    </span>
                  </span>
                  {busy === n.id ? (
                    <Spinner className="text-faint" />
                  ) : n.kind === 'folder' ? (
                    <ChevronRightIcon size={16} className="text-faint" />
                  ) : (
                    <DownloadIcon size={16} className="text-faint transition group-hover:text-ink" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AuthLayout>
  );
}

type DropItem = { id: number; file: File; status: 'queued' | 'uploading' | 'done' | 'error'; sent: number; error?: string; savedAs?: string };

function UploadDrop({ token, meta, password }: { token: string; meta: PublicMeta; password?: string }) {
  const { t, formatBytes } = useI18n();
  const [items, setItems] = useState<DropItem[]>([]);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const running = useRef(new Set<number>());
  const controllers = useRef(new Map<number, AbortController>());
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const patch = (id: number, p: Partial<DropItem>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...p } : i)));

  const pump = useCallback(() => {
    const list = itemsRef.current;
    for (const it of list) {
      if (running.current.size >= 3) break;
      if (it.status !== 'queued' || running.current.has(it.id)) continue;
      running.current.add(it.id);
      const ctrl = new AbortController();
      controllers.current.set(it.id, ctrl);
      patch(it.id, { status: 'uploading', sent: 0 });
      api
        .publicUpload(token, it.file, { password, signal: ctrl.signal, onProgress: (sent) => patch(it.id, { sent }) })
        .then((res) => patch(it.id, { status: 'done', sent: it.file.size, savedAs: res?.name }))
        .catch((e) => {
          if (ctrl.signal.aborted) return;
          const msg = e instanceof ApiError && e.status === 413 ? t('public.tooLarge') : e instanceof Error ? e.message : t('upload.failed');
          patch(it.id, { status: 'error', error: msg });
        })
        .finally(() => {
          running.current.delete(it.id);
          controllers.current.delete(it.id);
          window.setTimeout(pump, 0);
        });
    }
  }, [token, password, t]);

  useEffect(() => {
    pump();
  }, [items, pump]);

  function add(files: PickedFile[]) {
    if (!files.length) return;
    setItems((list) => [
      ...list,
      ...files.map((f) => ({ id: ++seq.current, file: f.file, status: 'queued' as const, sent: 0 })),
    ]);
  }

  const done = items.filter((i) => i.status === 'done').length;
  const failed = items.filter((i) => i.status === 'error').length;
  const active = items.some((i) => i.status === 'queued' || i.status === 'uploading');
  const total = items.reduce((a, i) => a + i.file.size, 0);
  const sent = items.reduce((a, i) => a + (i.status === 'done' ? i.file.size : i.sent), 0);

  return (
    <AuthLayout
      width="max-w-xl"
      title={t('public.dropTitle', { name: meta.name })}
      subtitle={t('public.dropSubtitle')}
      bare
    >
      <div
        onDragOver={(e) => {
          if (!dragHasFiles(e.dataTransfer)) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as globalThis.Node)) return;
          setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void collectDrop(e.dataTransfer).then(add);
        }}
        className={`panel flex flex-col items-center justify-center border-2 border-dashed px-6 py-12 text-center shadow-sm transition-colors ${
          over ? 'border-accent bg-accent-soft' : 'border-strong'
        }`}
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-sm">
          <UploadIcon size={24} />
        </span>
        <p className="mt-4 text-md font-semibold text-ink">{t('public.dropHere')}</p>
        <p className="mt-1 text-sm text-muted">{t('public.dropOr')}</p>
        <Button variant="primary" className="mt-4" onClick={() => inputRef.current?.click()}>
          {t('public.chooseFiles')}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            add(fromFileList(e.target.files));
            e.target.value = '';
          }}
        />
        <p className="mt-5 flex items-center gap-1.5 text-xs text-faint">
          <LockIcon size={12} /> {t('public.privacyNote')}
        </p>
      </div>

      {items.length > 0 && (
        <section aria-label={t('upload.panel')} className="panel mt-4 overflow-hidden shadow-sm">
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full ${
                active ? 'bg-accent-soft text-accent' : failed ? 'bg-danger-soft text-danger' : 'bg-ok-soft text-ok'
              }`}
            >
              {active ? <Spinner size={15} /> : failed ? <AlertIcon size={16} /> : <CheckCircleIcon size={16} />}
            </span>
            <div className="min-w-0 flex-1" aria-live="polite">
              <p className="text-base font-semibold text-ink">
                {active
                  ? t('public.sending', { count: items.filter((i) => i.status === 'queued' || i.status === 'uploading').length })
                  : t('public.sent', { count: done })}
              </p>
              <p className="text-xs text-muted tabular-nums">
                {active && `${t('public.deliveredOf', { done, total: items.length })} · `}
                {t('upload.progress', { sent: formatBytes(sent), total: formatBytes(total) })}
                {failed > 0 && ` · ${t('public.failedCount', { count: failed })}`}
              </p>
            </div>
          </div>
          {active && <ProgressBar value={total ? sent / total : 0} size="xs" className="mx-4 mt-2" />}
          <ul className="scroll-slim max-h-80 divide-y divide-line overflow-y-auto">
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-3 px-4 py-2.5">
                <FileGlyph name={it.file.name} mime={it.file.type} size={30} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{it.savedAs || it.file.name}</p>
                  {it.status === 'uploading' && <ProgressBar value={it.file.size ? it.sent / it.file.size : 0} size="xs" className="my-1" />}
                  <p className={`truncate text-xs ${it.status === 'error' ? 'text-danger' : 'text-muted'}`}>
                    {it.status === 'queued' && t('upload.queued')}
                    {it.status === 'uploading' && t('upload.progress', { sent: formatBytes(it.sent), total: formatBytes(it.file.size) })}
                    {it.status === 'done' && (it.savedAs && it.savedAs !== it.file.name ? t('public.savedAs', { name: it.savedAs }) : t('public.delivered'))}
                    {it.status === 'error' && it.error}
                  </p>
                </div>
                {it.status === 'done' && <CheckCircleIcon size={17} className="text-ok" />}
                {it.status === 'error' && (
                  <IconButton label={t('upload.retryItem', { name: it.file.name })} size="sm" onClick={() => patch(it.id, { status: 'queued', error: undefined })}>
                    <RefreshIcon size={14} />
                  </IconButton>
                )}
                {(it.status === 'queued' || it.status === 'uploading') && (
                  <IconButton
                    label={t('upload.cancelItem', { name: it.file.name })}
                    size="sm"
                    onClick={() => {
                      controllers.current.get(it.id)?.abort();
                      setItems((list) => list.filter((x) => x.id !== it.id));
                    }}
                  >
                    <CloseIcon size={14} />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </AuthLayout>
  );
}
