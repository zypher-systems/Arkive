import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { downloadUrl, type Node } from '../../lib/api';
import { Viewer } from '../../components/files/Viewer';
import { isEditableText, isMediaNode } from '../../components/files/types';
import { Spinner } from '../../components/ui/Spinner';

const TextEditor = lazy(() => import('../../components/editor/TextEditor'));

function triggerDownload(n: Node) {
  const a = document.createElement('a');
  a.href = downloadUrl(n.id);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Decides how a file opens — media viewer (images/video/audio/PDF with
 * prev/next across the folder), text editor, or download — and renders it.
 */
export function useOpener({
  nodes,
  canWrite,
  onSaved,
  onInfo,
}: {
  nodes: Node[];
  canWrite: boolean;
  onSaved?: (n: Node) => void;
  onInfo?: (n: Node) => void;
}) {
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Node | null>(null);
  const media = useMemo(() => nodes.filter(isMediaNode), [nodes]);
  const viewerIndex = viewerId ? media.findIndex((n) => n.id === viewerId) : -1;

  const open = useCallback(
    (n: Node, opts: { edit?: boolean } = {}) => {
      if (n.kind !== 'file') return false;
      if (isEditableText(n) || opts.edit) {
        setEditing(n);
        return true;
      }
      if (isMediaNode(n)) {
        setViewerId(n.id);
        return true;
      }
      triggerDownload(n);
      return true;
    },
    [],
  );

  const element = (
    <>
      {viewerIndex >= 0 && (
        <Viewer
          items={media}
          index={viewerIndex}
          onIndex={(i) => setViewerId(media[i]?.id ?? null)}
          onClose={() => setViewerId(null)}
          onInfo={
            onInfo
              ? (n) => {
                  setViewerId(null);
                  onInfo(n);
                }
              : undefined
          }
        />
      )}
      {editing && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-[140] flex items-center justify-center bg-surface">
              <Spinner size={24} className="text-faint" />
            </div>
          }
        >
          <TextEditor
            node={editing}
            canWrite={canWrite}
            onClose={() => setEditing(null)}
            onSaved={(u) => {
              setEditing((cur) => (cur && cur.id === u.id ? { ...cur, ...u } : cur));
              onSaved?.(u);
            }}
          />
        </Suspense>
      )}
    </>
  );

  return { open, element, isOpen: viewerIndex >= 0 || !!editing };
}
