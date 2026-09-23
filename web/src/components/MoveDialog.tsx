import { useCallback, useEffect, useState } from 'react';
import { ChevronRightIcon, FolderCopyIcon, FolderMoveIcon, HomeIcon } from './icons';
import { api, type Breadcrumb, type Node, type Workspace } from '../lib/api';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Notice } from './ui/Notice';
import { Select } from './ui/Input';
import { Spinner } from './ui/Spinner';
import { FileGlyph } from './files/FileThumb';
import { useI18n } from '../i18n';

type Props = {
  workspaceId: string;
  workspaces: Workspace[];
  nodes: Node[];
  mode?: 'move' | 'copy';
  /**
   * Browsing a folder shared with the user: its workspace belongs to someone
   * else, so the picker starts (and stops) at the shared folder.
   */
  root?: { id: string; name: string };
  onClose: () => void;
  onMoved: (dest: { workspaceId: string; parentId: string | null; mode: 'move' | 'copy' }) => void;
};

/** Folder picker for Move / Copy to… (cross-root destinations always copy). */
export function MoveDialog({ workspaceId, workspaces, nodes, mode = 'move', root, onClose, onMoved }: Props) {
  const { t } = useI18n();
  const [targetWs, setTargetWs] = useState(workspaceId);
  const topOf = (ws: string) => (root && ws === workspaceId ? root.id : null);
  const [parentId, setParentId] = useState<string | null>(topOf(workspaceId));
  const [folders, setFolders] = useState<Node[] | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const blocked = new Set(nodes.map((n) => n.id));
  const crossRoot = targetWs !== workspaceId;
  const effectiveMode = crossRoot ? 'copy' : mode;
  const sameFolder = !crossRoot && nodes.every((n) => (n.parent_id || null) === parentId);

  const load = useCallback(
    async (ws: string, pid: string | null) => {
      setFolders(null);
      try {
        const data = await api.listNodes(ws, pid);
        setFolders(data.nodes.filter((n) => n.kind === 'folder' && !blocked.has(n.id)));
        // Inside a shared folder, the path starts below the shared root.
        const top = root && ws === workspaceId ? data.breadcrumbs.findIndex((b) => b.id === root.id) : -1;
        setBreadcrumbs(top >= 0 ? data.breadcrumbs.slice(top + 1) : data.breadcrumbs);
        setParentId(pid);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setFolders([]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    void load(targetWs, topOf(targetWs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetWs, load]);

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      if (effectiveMode === 'copy') {
        await api.copyNodes(
          nodes.map((n) => n.id),
          targetWs,
          parentId,
        );
      } else {
        for (const n of nodes) await api.move(n.id, n.name, parentId);
      }
      onMoved({ workspaceId: targetWs, parentId, mode: effectiveMode });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('move.failed'));
    } finally {
      setBusy(false);
    }
  }

  const roots: Workspace[] =
    root && !workspaces.some((w) => w.id === workspaceId)
      ? [{ id: workspaceId, name: root.name, type: 'team', created_at: '' }, ...workspaces]
      : workspaces;
  const rootLabel = (w: Workspace) => (w.type === 'personal' ? t('nav.myFiles') : w.name);
  const currentRoot = roots.find((w) => w.id === targetWs);
  const title =
    effectiveMode === 'copy'
      ? t('move.copyTitle', { count: nodes.length, name: nodes[0]?.name ?? '' })
      : t('move.moveTitle', { count: nodes.length, name: nodes[0]?.name ?? '' });

  return (
    <Modal
      title={title}
      subtitle={crossRoot ? t('move.crossRoot') : t('move.subtitle')}
      icon={effectiveMode === 'copy' ? <FolderCopyIcon size={17} /> : <FolderMoveIcon size={17} />}
      onClose={onClose}
      busy={busy}
      width="max-w-lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={sameFolder && effectiveMode === 'move'} onClick={() => void confirm()}>
            {effectiveMode === 'copy' ? t('move.copyHere') : t('move.moveHere')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {roots.length > 1 && (
          <Select value={targetWs} onChange={(e) => setTargetWs(e.target.value)} aria-label={t('move.destinationRoot')}>
            {roots.map((w) => (
              <option key={w.id} value={w.id}>
                {rootLabel(w)}
              </option>
            ))}
          </Select>
        )}
        <nav aria-label={t('files.breadcrumbs')} className="flex flex-wrap items-center gap-0.5 text-sm text-muted">
          <button
            type="button"
            onClick={() => void load(targetWs, topOf(targetWs))}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 transition hover:bg-hover hover:text-ink"
          >
            <HomeIcon size={14} /> {currentRoot ? rootLabel(currentRoot) : t('move.root')}
          </button>
          {breadcrumbs.map((b, i) => (
            <span key={b.id} className="flex items-center gap-0.5">
              <ChevronRightIcon size={13} className="text-faint" />
              <button
                type="button"
                onClick={() => void load(targetWs, b.id)}
                className={`rounded-md px-1.5 py-1 transition hover:bg-hover hover:text-ink ${i === breadcrumbs.length - 1 ? 'font-medium text-ink' : ''}`}
              >
                {b.name}
              </button>
            </span>
          ))}
        </nav>
        <ul className="scroll-slim h-64 overflow-auto rounded-lg border border-line">
          {folders === null && (
            <li className="flex h-full items-center justify-center">
              <Spinner className="text-faint" />
            </li>
          )}
          {folders?.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => void load(targetWs, f.id)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-base transition hover:bg-hover coarse:py-3"
              >
                <FileGlyph name={f.name} kind="folder" size={24} />
                <span className="min-w-0 flex-1 truncate text-ink">{f.name}</span>
                <ChevronRightIcon size={14} className="shrink-0 text-faint" />
              </button>
            </li>
          ))}
          {folders?.length === 0 && (
            <li className="flex h-full items-center justify-center px-3 text-sm text-muted">{t('move.noSubfolders')}</li>
          )}
        </ul>
        {error && <Notice kind="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
