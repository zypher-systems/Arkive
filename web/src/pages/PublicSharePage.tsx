import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArkiveLogo } from '../components/ArkiveLogo';
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
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className={`w-full rounded-2xl border border-arkive-border bg-arkive-surface/90 p-6 ${
          ready && kind === 'folder' ? 'max-w-2xl text-left' : 'max-w-md text-center'
        }`}
      >
        <div className={`mb-4 flex ${ready && kind === 'folder' ? 'justify-start' : 'justify-center'}`}>
          <ArkiveLogo size={ready && kind === 'folder' ? 48 : 64} />
        </div>
        <h1 className="font-display text-2xl font-bold">Shared from Arkive</h1>

        {error && !needsPassword && (
          <p className="mt-4 text-sm text-red-300">{error}</p>
        )}

        {needsPassword && (
          <form onSubmit={onUnlock} className="mt-5 space-y-3 text-left">
            <p className="text-sm text-arkive-muted">This link is password protected.</p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2.5 outline-none focus:ring-2 focus:ring-arkive-amber/40"
            />
            {error && <p className="text-sm text-red-300">{error}</p>}
            <button
              type="submit"
              className="w-full cursor-pointer rounded-lg bg-gradient-to-r from-arkive-orange to-arkive-amber px-4 py-2.5 font-semibold text-black"
            >
              Unlock
            </button>
          </form>
        )}

        {ready && kind === 'file' && (
          <div className="mt-5 text-center">
            <p className="font-medium">{name}</p>
            <p className="mt-1 text-sm text-arkive-muted">File</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void downloadFile(undefined, name)}
              className="mt-5 inline-flex cursor-pointer rounded-lg bg-gradient-to-r from-arkive-orange to-arkive-amber px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-50"
            >
              {busy ? 'Preparing…' : 'Download'}
            </button>
            {listError && <p className="mt-3 text-sm text-red-300">{listError}</p>}
          </div>
        )}

        {ready && kind === 'folder' && (
          <div className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{name}</p>
                <nav className="mt-1 flex flex-wrap items-center gap-1 text-xs text-arkive-muted">
                  {breadcrumbs.map((crumb, i) => (
                    <span key={crumb.id} className="inline-flex items-center gap-1">
                      {i > 0 && <span>/</span>}
                      <button
                        type="button"
                        className={`cursor-pointer hover:text-arkive-amber ${
                          i === breadcrumbs.length - 1 ? 'text-arkive-text' : ''
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
                  <button
                    type="button"
                    className="cursor-pointer rounded-lg border border-arkive-border px-3 py-1.5 text-sm hover:border-arkive-amber/40"
                    onClick={() => {
                      const parent =
                        breadcrumbs.length > 1
                          ? breadcrumbs[breadcrumbs.length - 2].id
                          : rootId;
                      void loadFolder(parent, unlockedPass);
                    }}
                  >
                    Up
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void downloadZip([parentId || rootId])}
                  className="cursor-pointer rounded-lg bg-gradient-to-r from-arkive-orange to-arkive-amber px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
                >
                  {busy ? 'Zipping…' : 'Download folder'}
                </button>
              </div>
            </div>

            {listError && <p className="mt-3 text-sm text-red-300">{listError}</p>}

            <ul className="mt-4 divide-y divide-arkive-border overflow-hidden rounded-xl border border-arkive-border bg-arkive-bg/50">
              {nodes.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    onClick={() => openNode(node)}
                    className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left hover:bg-arkive-panel/50"
                  >
                    <FileThumb node={node} size="sm" allowContent={false} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{node.name}</span>
                      <span className="text-xs text-arkive-muted">
                        {node.kind === 'folder'
                          ? 'Folder'
                          : `${formatBytes(node.size)} · ${fileTypeLabel(node)}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-arkive-amber">
                      {node.kind === 'folder' ? 'Open' : 'Download'}
                    </span>
                  </button>
                </li>
              ))}
              {nodes.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-arkive-muted">
                  This folder is empty.
                </li>
              )}
            </ul>
          </div>
        )}
      </motion.div>
    </div>
  );
}
