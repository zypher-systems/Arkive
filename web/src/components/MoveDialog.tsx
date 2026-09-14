import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, ChevronRight, Folder, FolderInput, Home, Loader2 } from 'lucide-react';
import { api, type Breadcrumb, type Node, type Workspace } from '../lib/api';
import { Button } from './ui/Button';

type Props = {
  workspaceId: string;
  workspaces: Workspace[];
  nodes: Node[];
  mode?: 'move' | 'copy';
  onClose: () => void;
  onMoved: () => void;
};

export function MoveDialog({
  workspaceId,
  workspaces,
  nodes,
  mode = 'move',
  onClose,
  onMoved,
}: Props) {
  const roots = workspaces.filter((w) => w.type !== 'mount' || true);
  const [targetWs, setTargetWs] = useState(workspaceId);
  const [parentId, setParentId] = useState<string | null>(null);
  const [folders, setFolders] = useState<Node[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const blocked = new Set(nodes.map((n) => n.id));
  const crossRoot = targetWs !== workspaceId;
  const effectiveMode = crossRoot ? 'copy' : mode;

  async function load(ws: string, pid: string | null) {
    const data = await api.listNodes(ws, pid);
    setFolders(data.nodes.filter((n) => n.kind === 'folder' && !blocked.has(n.id)));
    setBreadcrumbs(data.breadcrumbs);
    setParentId(pid);
  }

  useEffect(() => {
    void load(targetWs, null).catch((e) => setError(String(e)));
  }, [targetWs]);

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      if (effectiveMode === 'copy' || crossRoot) {
        await api.copyNodes(
          nodes.map((n) => n.id),
          targetWs,
          parentId,
        );
      } else {
        for (const n of nodes) {
          await api.move(n.id, n.name, parentId);
        }
      }
      onMoved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#03040c]/70 p-4 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="glass-strong glass-hairline w-full max-w-md rounded-3xl p-6 shadow-[0_24px_80px_rgba(3,4,12,0.7)]"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-arkive-accent/25 to-arkive-accent2/20 text-arkive-accent2 ring-1 ring-white/10">
            <FolderInput size={18} />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight">
              {effectiveMode === 'copy' ? 'Copy' : 'Move'} {nodes.length} item(s)
            </h2>
            <p className="text-sm text-arkive-muted">
              {crossRoot
                ? 'Cross-root destination — items will be copied.'
                : 'Choose a destination folder.'}
            </p>
          </div>
        </div>

        <label className="mt-5 block text-sm">
          <span className="mb-1.5 block text-xs font-medium tracking-wide text-arkive-muted uppercase">
            Destination root
          </span>
          <select
            value={targetWs}
            onChange={(e) => setTargetWs(e.target.value)}
            className="input-glass cursor-pointer [&>option]:bg-arkive-surface"
          >
            {roots.map((w) => (
              <option key={w.id} value={w.id}>
                {w.type === 'personal' ? 'My files' : w.name}
              </option>
            ))}
          </select>
        </label>

        <nav className="mt-4 flex flex-wrap items-center gap-0.5 text-sm text-arkive-muted">
          <button
            type="button"
            onClick={() => void load(targetWs, null)}
            className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 transition hover:bg-white/[0.07] hover:text-arkive-text"
          >
            <Home size={13} /> Root
          </button>
          {breadcrumbs.map((b) => (
            <span key={b.id} className="flex items-center gap-0.5">
              <ChevronRight size={13} className="text-arkive-muted/50" />
              <button
                type="button"
                onClick={() => void load(targetWs, b.id)}
                className="cursor-pointer rounded-lg px-2 py-1 transition hover:bg-white/[0.07] hover:text-arkive-text"
              >
                {b.name}
              </button>
            </span>
          ))}
        </nav>

        <ul className="scroll-slim mt-3 max-h-56 divide-y divide-white/4 overflow-auto rounded-2xl border border-white/7 bg-black/20">
          {folders.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => void load(targetWs, f.id)}
                className="flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition hover:bg-white/[0.05]"
              >
                <Folder size={15} className="shrink-0 text-arkive-accent2" />
                <span className="truncate">{f.name}</span>
                <ChevronRight size={13} className="ml-auto shrink-0 text-arkive-muted/50" />
              </button>
            </li>
          ))}
          {folders.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-arkive-muted">No subfolders here.</li>
          )}
        </ul>

        {error && (
          <p className="mt-3 flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            <AlertCircle size={14} className="shrink-0" />
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="glass" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="font-semibold"
            disabled={busy}
            icon={busy ? <Loader2 size={14} className="animate-spin" /> : <FolderInput size={14} />}
            onClick={() => void confirm()}
          >
            {effectiveMode === 'copy' ? 'Copy here' : 'Move here'}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
