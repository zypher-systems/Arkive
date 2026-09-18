import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  DownloadIcon,
  FolderOpenIcon,
  LockIcon,
  SpinnerIcon,
} from '../components/icons';
import { ArkiveLogo } from '../components/ArkiveLogo';
import { Button } from '../components/ui/Button';
import { api, formatBytes, type Breadcrumb, type Node } from '../lib/api';
import { FileThumb } from '../components/files/FileThumb';
import { fileTypeLabel } from '../components/files/types';

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function PublicSharePage() {
  const { token = '' } = useParams();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [rootId, setRootId] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [unlockedPass, setUnlockedPass] = useState<string | undefined>(undefined);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [parentId, setParentId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [busy, setBusy] = useState(false);
  const [listError, setListError] = useState('');

  const loadFolder = useCallback(
    async (folderId: string | null, pass?: string) => {
      setListError('');
      try {
        const data = await api.publicNodes(token, folderId, pass);
        setNodes(data.nodes);
        setBreadcrumbs(data.breadcrumbs);
        setRootId(data.root.id);
        setParentId(folderId || data.root.id);
      } catch (err) {
        const e = err as Error & { status?: number; data?: { needs_password?: boolean } };
        if (e.status === 401 || e.data?.needs_password) {
          setNeedsPassword(true);
          setReady(false);
          throw e;
        }
        setListError(e.message || 'Could not list folder');
      }
    },
    [token],
  );

  async function load(pass?: string) {
    setError('');
    try {
      const meta = await api.publicMeta(token, pass);
      setName(meta.name);
      setKind(meta.kind);
      setRootId(meta.node_id);
      setNeedsPassword(false);
      setReady(true);
      if (pass) setUnlockedPass(pass);
      if (meta.kind === 'folder') {
        await loadFolder(meta.node_id, pass);
      }
    } catch (err) {
      const e = err as Error & { status?: number; data?: { needs_password?: boolean } };
      if (e.status === 401 || e.data?.needs_password) {
        setNeedsPassword(true);
        setReady(false);
        if (pass) setError('Incorrect password');
        return;
      }
      setError(e.message || 'Link unavailable');
      setReady(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per token
  }, [token]);

  function onUnlock(e: FormEvent) {
    e.preventDefault();
    void load(password);
  }

  async function downloadFile(nodeId?: string, filenameHint?: string) {
    setBusy(true);
    setListError('');
    try {
      const { blob, filename } = await api.publicDownload(token, nodeId, unlockedPass);
      triggerBlobDownload(blob, filenameHint || filename);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setBusy(false);
    }
  }

  async function downloadZip(nodeIds?: string[]) {
    setBusy(true);
    setListError('');
    try {
      const { blob, filename } = await api.publicDownloadZip(token, nodeIds, unlockedPass);
      triggerBlobDownload(blob, filename);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Zip download failed');
    } finally {
      setBusy(false);
    }
  }

  function openNode(node: Node) {
    if (node.kind === 'folder') {
      void loadFolder(node.id, unlockedPass);
      return;
    }
    void downloadFile(node.id, node.name);
  }

  const atRoot = !parentId || parentId === rootId;

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div
        className={`animate-fade-up panel w-full p-6 shadow-sm sm:p-7 ${
          ready && kind === 'folder' ? 'max-w-2xl text-left' : 'max-w-[400px] text-center'
        }`}
      >
        <div className={`mb-4 flex ${ready && kind === 'folder' ? 'justify-start' : 'flex-col items-center justify-center'}`}>
          <ArkiveLogo size={ready && kind === 'folder' ? 32 : 40} className="text-primary" />
        </div>
        <h1 className={`text-xl font-semibold tracking-tight ${ready && kind === 'folder' ? '' : 'mt-3'}`}>
          Shared from Arkive
        </h1>

        {error && !needsPassword && (
          <p className="mt-4 flex items-center justify-center gap-2 text-sm text-danger">
            <AlertIcon size={14} className="shrink-0" /> {error}
          </p>
        )}

        {needsPassword && (
          <form onSubmit={onUnlock} className="mt-5 space-y-3 text-left">
            <p className="flex items-center gap-2 text-sm text-muted">
              <LockIcon size={14} /> This link is password protected.
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="input-field"
            />
            {error && (
              <p className="flex items-center gap-2 text-sm text-danger">
                <AlertIcon size={14} /> {error}
              </p>
            )}
            <Button type="submit" variant="primary" full icon={<LockIcon size={14} />}>
              Unlock
            </Button>
          </form>
        )}

        {ready && kind === 'file' && (
          <div className="mt-6 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md border border-line bg-inset text-muted">
              <DownloadIcon size={22} />
            </div>
            <p className="font-medium">{name}</p>
            <p className="mt-1 text-sm text-muted">File</p>
            <Button
              variant="primary"
              className="mt-5"
              disabled={busy}
              onClick={() => void downloadFile(undefined, name)}
              icon={busy ? <SpinnerIcon size={14} className="animate-spin" /> : <DownloadIcon size={14} />}
            >
              {busy ? 'Preparing…' : 'Download'}
            </Button>
            {listError && (
              <p className="mt-3 flex items-center justify-center gap-2 text-sm text-danger">
                <AlertIcon size={14} /> {listError}
              </p>
            )}
          </div>
        )}

        {ready && kind === 'folder' && (
          <div className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-[15px] font-semibold">
                  <FolderOpenIcon size={16} className="shrink-0 text-accent-strong" />
                  {name}
                </p>
                <nav className="mt-1.5 flex flex-wrap items-center gap-0.5 text-xs text-muted">
                  {breadcrumbs.map((crumb, i) => (
                    <span key={crumb.id} className="inline-flex items-center gap-0.5">
                      {i > 0 && <ChevronRightIcon size={11} className="text-faint" />}
                      <button
                        type="button"
                        className={`cursor-pointer rounded px-1.5 py-0.5 transition hover:bg-hover hover:text-accent-strong ${
                          i === breadcrumbs.length - 1 ? 'font-medium text-ink' : ''
                        }`}
                        onClick={() => void loadFolder(crumb.id, unlockedPass)}
                      >
                        {crumb.name}
                      </button>
                    </span>
                  ))}
                </nav>
              </div>
              <div className="flex shrink-0 gap-2">
                {!atRoot && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<ArrowUpIcon size={13} />}
                    onClick={() => {
                      const parent =
                        breadcrumbs.length > 1
                          ? breadcrumbs[breadcrumbs.length - 2].id
                          : rootId;
                      void loadFolder(parent, unlockedPass);
                    }}
                  >
                    Up
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void downloadZip([parentId || rootId])}
                  icon={busy ? <SpinnerIcon size={13} className="animate-spin" /> : <DownloadIcon size={13} />}
                >
                  {busy ? 'Zipping…' : 'Download folder'}
                </Button>
              </div>
            </div>

            {listError && (
              <p className="mt-3 flex items-center gap-2 text-sm text-danger">
                <AlertIcon size={14} /> {listError}
              </p>
            )}

            <ul className="scroll-slim mt-4 divide-y divide-line overflow-hidden rounded-md border border-line bg-inset">
              {nodes.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    onClick={() => openNode(node)}
                    className="group flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-hover"
                  >
                    <FileThumb node={node} size="sm" allowContent={false} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{node.name}</span>
                      <span className="text-xs text-muted">
                        {node.kind === 'folder'
                          ? 'Folder'
                          : `${formatBytes(node.size)} · ${fileTypeLabel(node)}`}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-medium text-accent-strong opacity-70 transition group-hover:bg-hover group-hover:opacity-100">
                      {node.kind === 'folder' ? (
                        <>Open <ChevronRightIcon size={12} /></>
                      ) : (
                        <><DownloadIcon size={12} /> Download</>
                      )}
                    </span>
                  </button>
                </li>
              ))}
              {nodes.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-muted">
                  This folder is empty.
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
