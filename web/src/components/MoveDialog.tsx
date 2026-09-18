import { useEffect, useState } from 'react';
import {
  ChevronRightIcon,
  FolderIcon,
  FolderMoveIcon,
  HomeIcon,
  SpinnerIcon,
} from './icons';
import { api, type Breadcrumb, type Node, type Workspace } from '../lib/api';
import { Button } from './ui/Button';
import { Modal, ModalField } from './ui/Modal';
import { Notice } from './ui/Notice';

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

  const titleVerb = effectiveMode === 'copy' ? 'Copy' : 'Move';

  return (
    <Modal
      title={`${titleVerb} ${nodes.length} item${nodes.length === 1 ? '' : 's'}`}
      subtitle={
        crossRoot
          ? 'Cross-root destination — items will be copied.'
          : 'Choose a destination folder.'
      }
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            icon={
              busy ? (
                <SpinnerIcon size={13} className="animate-spin" />
              ) : (
                <FolderMoveIcon size={14} />
              )
            }
            onClick={() => void confirm()}
          >
            {effectiveMode === 'copy' ? 'Copy here' : 'Move here'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ModalField label="Destination root">
          <select
            value={targetWs}
            onChange={(e) => setTargetWs(e.target.value)}
            className="input-field cursor-pointer"
          >
            {roots.map((w) => (
              <option key={w.id} value={w.id}>
                {w.type === 'personal' ? 'My files' : w.name}
              </option>
            ))}
          </select>
        </ModalField>

        <nav className="flex flex-wrap items-center gap-0.5 text-[13px] text-muted">
          <button
            type="button"
            onClick={() => void load(targetWs, null)}
            className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 transition hover:bg-hover hover:text-ink"
          >
            <HomeIcon size={13} /> Root
          </button>
          {breadcrumbs.map((b) => (
            <span key={b.id} className="flex items-center gap-0.5">
              <ChevronRightIcon size={12} className="text-faint" />
              <button
                type="button"
                onClick={() => void load(targetWs, b.id)}
                className="cursor-pointer rounded px-1.5 py-1 transition hover:bg-hover hover:text-ink"
              >
                {b.name}
              </button>
            </span>
          ))}
        </nav>

        <ul className="scroll-slim max-h-56 divide-y divide-line overflow-auto rounded-md border border-line bg-inset">
          {folders.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => void load(targetWs, f.id)}
                className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-hover"
              >
                <FolderIcon size={15} className="shrink-0 text-accent" />
                <span className="truncate">{f.name}</span>
                <ChevronRightIcon size={13} className="ml-auto shrink-0 text-faint" />
              </button>
            </li>
          ))}
          {folders.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-muted">No subfolders here.</li>
          )}
        </ul>

        {error && <Notice kind="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
