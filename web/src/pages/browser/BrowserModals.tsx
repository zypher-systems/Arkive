import type { Node, Workspace } from '../../lib/api';
import { SharePanel } from '../../components/SharePanel';
import { PreviewModal } from '../../components/PreviewModal';
import { MoveDialog } from '../../components/MoveDialog';
import { VersionsPanel } from '../../components/VersionsPanel';
import { NamePrompt } from '../../components/NamePrompt';

export type NamePromptState =
  | { kind: 'mkdir' }
  | { kind: 'newfile' }
  | { kind: 'rename'; node: Node }
  | null;

export type BrowserModalsProps = {
  namePrompt: NamePromptState;
  nameBusy: boolean;
  onConfirmName: (name: string) => void;
  onCloseNamePrompt: () => void;

  shareNode: Node | null;
  workspaces: Workspace[];
  onCloseShare: () => void;

  previewNode: Node | null;
  previewStartEditing: boolean;
  canWrite: boolean;
  onClosePreview: () => void;
  onPreviewSaved: (updated: Node) => void;

  historyNode: Node | null;
  onCloseHistory: () => void;

  showMove: boolean;
  selectedNodes: Node[];
  workspaceId: string;
  moveMode: 'move' | 'copy';
  onCloseMove: () => void;
  onMoved: () => void;
};

export function BrowserModals({
  namePrompt,
  nameBusy,
  onConfirmName,
  onCloseNamePrompt,
  shareNode,
  workspaces,
  onCloseShare,
  previewNode,
  previewStartEditing,
  canWrite,
  onClosePreview,
  onPreviewSaved,
  historyNode,
  onCloseHistory,
  showMove,
  selectedNodes,
  workspaceId,
  moveMode,
  onCloseMove,
  onMoved,
}: BrowserModalsProps) {
  return (
    <>
      {namePrompt && (
        <NamePrompt
          title={
            namePrompt.kind === 'mkdir'
              ? 'New folder'
              : namePrompt.kind === 'newfile'
                ? 'New file'
                : 'Rename'
          }
          label={
            namePrompt.kind === 'mkdir'
              ? 'Folder name'
              : namePrompt.kind === 'newfile'
                ? 'File name (.txt or .md)'
                : 'Name'
          }
          initialValue={
            namePrompt.kind === 'rename'
              ? namePrompt.node.name
              : namePrompt.kind === 'newfile'
                ? 'Untitled.txt'
                : ''
          }
          confirmLabel={namePrompt.kind === 'rename' ? 'Rename' : 'Create'}
          busy={nameBusy}
          onConfirm={onConfirmName}
          onClose={onCloseNamePrompt}
        />
      )}

      {shareNode && (
        <SharePanel
          nodeId={shareNode.id}
          nodeName={shareNode.name}
          workspaces={workspaces.filter((w) => w.type !== 'mount')}
          onClose={onCloseShare}
        />
      )}

      {previewNode && (
        <PreviewModal
          node={previewNode}
          startEditing={previewStartEditing}
          canWrite={canWrite}
          onClose={onClosePreview}
          onSaved={onPreviewSaved}
        />
      )}

      {historyNode && <VersionsPanel node={historyNode} onClose={onCloseHistory} />}

      {showMove && selectedNodes.length > 0 && workspaceId && (
        <MoveDialog
          workspaceId={workspaceId}
          workspaces={workspaces}
          nodes={selectedNodes}
          mode={moveMode}
          onClose={onCloseMove}
          onMoved={onMoved}
        />
      )}
    </>
  );
}
