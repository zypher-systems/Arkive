import { useEffect, useState } from 'react';
import { api, type Breadcrumb, type Node, type Workspace } from '../lib/api';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-arkive-border bg-arkive-surface p-5">
        <h2 className="font-display text-xl font-bold">
          {effectiveMode === 'copy' ? 'Copy' : 'Move'} {nodes.length} item(s)
        </h2>
        <p className="mt-1 text-sm text-arkive-muted">
          {crossRoot
            ? 'Cross-root destination — items will be copied.'
            : 'Choose a destination folder.'}
        </p>

        <label className="mt-4 block text-sm">
          <span className="mb-1 block text-arkive-muted">Destination root</span>
          <select
            value={targetWs}
            onChange={(e) => setTargetWs(e.target.value)}
            className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2"
          >
            {roots.map((w) => (
              <option key={w.id} value={w.id}>
                {w.type === 'personal' ? 'My files' : w.name}
              </option>
            ))}
          </select>
        </label>

        <nav className="mt-4 flex flex-wrap items-center gap-1 text-sm text-arkive-muted">
          <button
            type="button"
            onClick={() => void load(targetWs, null)}
            className="hover:text-arkive-text"
          >
            Root
          </button>
          {breadcrumbs.map((b) => (
            <span key={b.id} className="flex items-center gap-1">
              <span>/</span>
              <button
                type="button"
                onClick={() => void load(targetWs, b.id)}
                className="hover:text-arkive-text"
              >
                {b.name}
              </button>
            </span>
          ))}
        </nav>

        <ul className="mt-3 max-h-56 divide-y divide-arkive-border overflow-auto rounded-xl border border-arkive-border">
          {folders.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => void load(targetWs, f.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-arkive-panel/50"
              >
                <span className="text-arkive-amber">DIR</span>
                {f.name}
              </button>
            </li>
          ))}
          {folders.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-arkive-muted">No subfolders here.</li>
          )}
        </ul>

        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-arkive-border px-3 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirm()}
            className="rounded-lg bg-gradient-to-r from-arkive-orange to-arkive-amber px-3 py-2 text-sm font-semibold text-black disabled:opacity-50"
          >
            {effectiveMode === 'copy' ? 'Copy here' : 'Move here'}
          </button>
        </div>
      </div>
    </div>
  );
}
