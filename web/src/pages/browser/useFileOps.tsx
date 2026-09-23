import { useCallback, useState } from 'react';
import { api, downloadUrl, type Node, type Workspace } from '../../lib/api';
import { useConfirm } from '../../lib/confirm';
import { ensureExtension } from '../../lib/paths';
import { useToast } from '../../components/Toast';
import { NamePrompt } from '../../components/NamePrompt';
import { MoveDialog } from '../../components/MoveDialog';
import { FilePlusIcon, FolderPlusIcon, PencilIcon } from '../../components/icons';
import { useI18n } from '../../i18n';
import { useWorkspaces } from '../../lib/workspaces';

type Prompt =
  | { kind: 'mkdir' }
  | { kind: 'newfile'; ext: '.txt' | '.md' }
  | { kind: 'rename'; node: Node }
  | null;

/**
 * File operations for one folder, with their dialogs, confirmations and
 * toasts (including "Undo" after moving items to trash).
 */
export function useFileOps({
  workspaceId,
  parentId,
  nodes,
  workspaces,
  reload,
  onFileCreated,
  onRenamed,
  sharedRoot,
}: {
  workspaceId?: string;
  parentId: string | null;
  nodes: Node[];
  workspaces: Workspace[];
  reload: (silent?: boolean) => Promise<void> | void;
  onFileCreated?: (n: Node) => void;
  onRenamed?: (n: Node) => void;
  /** Set when browsing a folder shared with the user (see MoveDialog). */
  sharedRoot?: { id: string; name: string };
}) {
  const { t } = useI18n();
  const { toast, dismiss } = useToast();
  const { refreshUsage } = useWorkspaces();
  const { ask, dialog: confirmDialog, isOpen: confirmOpen } = useConfirm();
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptError, setPromptError] = useState('');
  const [move, setMove] = useState<{ nodes: Node[]; mode: 'move' | 'copy' } | null>(null);
  const [clipboard, setClipboard] = useState<{ ids: string[]; workspaceId: string } | null>(null);

  const fail = useCallback((e: unknown, fallback: string) => {
    toast({ tone: 'error', message: e instanceof Error && e.message ? e.message : fallback });
  }, [toast]);

  const newFolder = useCallback(() => {
    setPromptError('');
    setPrompt({ kind: 'mkdir' });
  }, []);
  const newFile = useCallback((ext: '.txt' | '.md' = '.txt') => {
    setPromptError('');
    setPrompt({ kind: 'newfile', ext });
  }, []);
  const rename = useCallback((node: Node) => {
    setPromptError('');
    setPrompt({ kind: 'rename', node });
  }, []);

  async function submitPrompt(name: string) {
    if (!prompt || !workspaceId) return;
    setPromptBusy(true);
    setPromptError('');
    try {
      if (prompt.kind === 'mkdir') {
        await api.mkdir(workspaceId, name, parentId);
        toast({ message: t('files.folderCreated', { name }) });
      } else if (prompt.kind === 'newfile') {
        const fileName = ensureExtension(name, prompt.ext);
        const mime = /\.(md|markdown)$/i.test(fileName) ? 'text/markdown' : 'text/plain';
        const file = new File([''], fileName, { type: mime });
        const created = await api.upload(workspaceId, file, parentId);
        onFileCreated?.(created);
      } else {
        const updated = await api.rename(prompt.node.id, name);
        onRenamed?.(updated);
      }
      setPrompt(null);
      await reload(true);
      void refreshUsage();
    } catch (e) {
      setPromptError(e instanceof Error ? e.message : t('common.failed'));
    } finally {
      setPromptBusy(false);
    }
  }

  const restoreMany = useCallback(
    async (ids: string[]) => {
      try {
        for (const id of ids) await api.restore(id);
        await reload(true);
        void refreshUsage();
        toast({ message: t('files.restored', { count: ids.length }) });
      } catch (e) {
        fail(e, t('files.restoreFailed'));
      }
    },
    [reload, refreshUsage, toast, t, fail],
  );

  const trash = useCallback(
    (items: Node[], opts: { confirm?: boolean } = {}) => {
      if (!items.length) return;
      const run = async () => {
        const done: string[] = [];
        try {
          for (const n of items) {
            await api.remove(n.id);
            done.push(n.id);
          }
        } catch (e) {
          fail(e, t('files.deleteFailed'));
        }
        await reload(true);
        void refreshUsage();
        if (done.length) {
          toast({
            message: t('files.trashed', { count: done.length, name: items[0].name }),
            action: { label: t('common.undo'), onClick: () => void restoreMany(done) },
          });
        }
      };
      if (opts.confirm === false) {
        void run();
        return;
      }
      ask({
        title: t('files.trashTitle', { count: items.length }),
        message: t('files.trashMessage', { count: items.length, name: items[0].name }),
        confirmLabel: t('files.moveToTrash'),
        run,
      });
    },
    [ask, reload, refreshUsage, toast, t, fail, restoreMany],
  );

  const download = useCallback(
    async (items: Node[]) => {
      if (!items.length || !workspaceId) return;
      if (items.length === 1 && items[0].kind === 'file') {
        const a = document.createElement('a');
        a.href = downloadUrl(items[0].id);
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
      }
      const id = toast({ tone: 'info', message: t('files.zipping', { count: items.length }), duration: 0 });
      try {
        await api.downloadZip(workspaceId, items.map((n) => n.id));
      } catch (e) {
        fail(e, t('files.zipFailed'));
      } finally {
        dismiss(id);
      }
    },
    [workspaceId, toast, dismiss, t, fail],
  );

  const moveInto = useCallback(
    async (ids: string[], targetParent: string | null) => {
      const byId = new Map(nodes.map((n) => [n.id, n]));
      let moved = 0;
      try {
        for (const id of ids) {
          if (id === targetParent) continue;
          const n = byId.get(id);
          if (!n) continue;
          if ((n.parent_id || null) === targetParent) continue;
          await api.move(id, n.name, targetParent);
          moved++;
        }
        if (moved) toast({ message: t('files.moved', { count: moved }) });
      } catch (e) {
        fail(e, t('files.moveFailed'));
      }
      await reload(true);
    },
    [nodes, reload, toast, t, fail],
  );

  const copyToClipboard = useCallback(
    (items: Node[]) => {
      if (!items.length || !workspaceId) return;
      setClipboard({ ids: items.map((n) => n.id), workspaceId });
      toast({ tone: 'info', message: t('files.copiedToClipboard', { count: items.length }) });
    },
    [workspaceId, toast, t],
  );

  const paste = useCallback(async () => {
    if (!clipboard || !workspaceId) return;
    try {
      await api.copyNodes(clipboard.ids, workspaceId, parentId);
      toast({ message: t('files.pasted', { count: clipboard.ids.length }) });
      await reload(true);
      void refreshUsage();
    } catch (e) {
      fail(e, t('files.pasteFailed'));
    }
  }, [clipboard, workspaceId, parentId, reload, refreshUsage, toast, t, fail]);

  const siblings = nodes.map((n) => n.name);

  const dialogs = (
    <>
      {prompt && (
        <NamePrompt
          title={
            prompt.kind === 'mkdir'
              ? t('files.newFolder')
              : prompt.kind === 'newfile'
                ? prompt.ext === '.md'
                  ? t('files.newMarkdownFile')
                  : t('files.newTextFile')
                : t('files.renameTitle')
          }
          icon={
            prompt.kind === 'mkdir' ? <FolderPlusIcon size={17} /> : prompt.kind === 'newfile' ? <FilePlusIcon size={17} /> : <PencilIcon size={16} />
          }
          label={prompt.kind === 'mkdir' ? t('files.folderName') : t('files.fileName')}
          initialValue={
            prompt.kind === 'rename'
              ? prompt.node.name
              : prompt.kind === 'newfile'
                ? `${t('files.untitled')}${prompt.ext}`
                : t('files.untitledFolder')
          }
          isFolder={prompt.kind === 'mkdir' || (prompt.kind === 'rename' && prompt.node.kind === 'folder')}
          siblings={siblings}
          confirmLabel={prompt.kind === 'rename' ? t('files.rename') : t('common.create')}
          busy={promptBusy}
          error={promptError}
          onConfirm={(name) => void submitPrompt(name)}
          onClose={() => !promptBusy && setPrompt(null)}
        />
      )}
      {move && workspaceId && (
        <MoveDialog
          workspaceId={workspaceId}
          workspaces={workspaces.filter((w) => w.type !== 'mount' || w.id === workspaceId)}
          nodes={move.nodes}
          mode={move.mode}
          root={sharedRoot}
          onClose={() => setMove(null)}
          onMoved={({ mode }) => {
            toast({ message: mode === 'copy' ? t('files.copied', { count: move.nodes.length }) : t('files.moved', { count: move.nodes.length }) });
            void reload(true);
            void refreshUsage();
          }}
        />
      )}
      {confirmDialog}
    </>
  );

  return {
    newFolder,
    newFile,
    rename,
    trash,
    download,
    moveTo: (items: Node[]) => setMove({ nodes: items, mode: 'move' }),
    copyTo: (items: Node[]) => setMove({ nodes: items, mode: 'copy' }),
    moveInto,
    copyToClipboard,
    paste,
    canPaste: !!clipboard && clipboard.workspaceId === workspaceId,
    restoreMany,
    dialogs,
    dialogOpen: !!prompt || !!move || confirmOpen,
  };
}
