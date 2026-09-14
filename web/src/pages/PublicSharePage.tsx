import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowUp,
  ChevronRight,
  Download,
  FileDown,
  FolderOpen,
  Loader2,
  Lock,
} from 'lucide-react';
import { ArkiveLogo, ArkiveWordmark } from '../components/ArkiveLogo';
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
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-10">
      <div
        className="aurora-blob animate-aurora-c left-1/2 top-[-25vh] h-[60vh] w-[60vh] -translate-x-1/2 bg-[radial-gradient(circle,rgba(139,92,246,0.22),transparent_65%)]"
        aria-hidden
      />
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className={`glass-strong glass-hairline relative w-full rounded-3xl p-6 shadow-[0_24px_80px_rgba(3,4,12,0.6)] sm:p-7 ${
          ready && kind === 'folder' ? 'max-w-2xl text-left' : 'max-w-md text-center'
        }`}
      >
        <div className={`mb-4 flex ${ready && kind === 'folder' ? 'justify-start' : 'flex-col items-center justify-center'}`}>
          <ArkiveLogo size={ready && kind === 'folder' ? 44 : 72} />
        </div>
        <h1 className={`font-display text-2xl font-bold tracking-tight ${ready && kind === 'folder' ? '' : 'mt-4'}`}>
          Shared from <ArkiveWordmark className="text-2xl" />
        </h1>

        {error && !needsPassword && (
          <p className="mt-4 flex items-center justify-center gap-2 text-sm text-red-300">
            <AlertCircle size={14} className="shrink-0" /> {error}
          </p>
        )}

        {needsPassword && (
          <form onSubmit={onUnlock} className="mt-5 space-y-3 text-left">
            <p className="flex items-center gap-2 text-sm text-arkive-muted">
              <Lock size={14} className="text-arkive-accent2" /> This link is password protected.
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="input-glass"
            />
            {error && (
              <p className="flex items-center gap-2 text-sm text-red-300">
                <AlertCircle size={14} /> {error}
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" full className="font-semibold" icon={<Lock size={14} />}>
              Unlock
            </Button>
          </form>
        )}

        {ready && kind === 'file' && (
          <div className="mt-6 text-center">
            <div className="relative mx-auto mb-4 w-fit">
              <div className="absolute inset-0 scale-150 rounded-full bg-arkive-accent/20 blur-2xl" aria-hidden />
              <div className="glass relative mx-auto flex h-16 w-16 items-center justify-center rounded-3xl text-arkive-accent2">
                <FileDown size={26} />
              </div>
            </div>
            <p className="font-medium">{name}</p>
            <p className="mt-1 text-sm text-arkive-muted">File</p>
            <Button
              variant="primary"
              size="lg"
              className="mt-5 font-semibold"
              disabled={busy}
              onClick={() => void downloadFile(undefined, name)}
              icon={busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            >
              {busy ? 'Preparing…' : 'Download'}
            </Button>
            {listError && (
              <p className="mt-3 flex items-center justify-center gap-2 text-sm text-red-300">
                <AlertCircle size={14} /> {listError}
              </p>
            )}
          </div>
        )}

        {ready && kind === 'folder' && (
          <div className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate font-display font-semibold">
                  <FolderOpen size={16} className="shrink-0 text-arkive-accent2" />
                  {name}
                </p>
                <nav className="mt-1.5 flex flex-wrap items-center gap-0.5 text-xs text-arkive-muted">
                  {breadcrumbs.map((crumb, i) => (
                    <span key={crumb.id} className="inline-flex items-center gap-0.5">
                      {i > 0 && <ChevronRight size={11} className="text-arkive-muted/50" />}
                      <button
                        type="button"
                        className={`cursor-pointer rounded-md px-1.5 py-0.5 transition hover:bg-white/[0.07] hover:text-arkive-accent2 ${
                          i === breadcrumbs.length - 1 ? 'font-medium text-arkive-text' : ''
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
                    variant="glass"
                    size="sm"
                    icon={<ArrowUp size={13} />}
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
                  className="font-semibold"
                  disabled={busy}
                  onClick={() => void downloadZip([parentId || rootId])}
                  icon={busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                >
                  {busy ? 'Zipping…' : 'Download folder'}
                </Button>
              </div>
            </div>

            {listError && (
              <p className="mt-3 flex items-center gap-2 text-sm text-red-300">
                <AlertCircle size={14} /> {listError}
              </p>
            )}

            <ul className="scroll-slim mt-4 divide-y divide-white/4 overflow-hidden rounded-2xl border border-white/7 bg-black/25">
              {nodes.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    onClick={() => openNode(node)}
                    className="group flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.05]"
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
                    <span className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-arkive-accent2 opacity-70 transition group-hover:bg-white/[0.07] group-hover:opacity-100">
                      {node.kind === 'folder' ? (
                        <>Open <ChevronRight size={12} /></>
                      ) : (
                        <><Download size={12} /> Download</>
                      )}
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
