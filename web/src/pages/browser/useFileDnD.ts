import { useRef, useState, type DragEvent } from 'react';
import type { Node } from '../../lib/api';

export const DRAG_MIME = 'application/x-arkive-nodes';

/** Compact translucent icon+name chip for HTML5 drag ghosts. */
function setCompactDragGhost(e: DragEvent, node: Node, count: number) {
  const row = e.currentTarget as HTMLElement | null;
  if (!row) return;

  document.querySelectorAll('[data-arkive-drag-ghost]').forEach((n) => n.remove());

  const ghost = document.createElement('div');
  ghost.setAttribute('data-arkive-drag-ghost', '1');
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  Object.assign(ghost.style, {
    position: 'fixed',
    top: '-9999px',
    left: '0',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 14px 8px 8px',
    maxWidth: '260px',
    borderRadius: '6px',
    border: dark ? '1px solid #3d434f' : '1px solid #cfcfc8',
    background: dark ? '#1c1f25' : '#ffffff',
    boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
    color: dark ? '#e8eaed' : '#1b1d21',
    fontSize: '13px',
    fontWeight: '600',
    lineHeight: '1.2',
    opacity: '0.95',
    pointerEvents: 'none',
    zIndex: '99999',
  } as Partial<CSSStyleDeclaration>);

  const thumbHost = row.querySelector('[data-drag-thumb]') as HTMLElement | null;
  if (thumbHost) {
    const clone = thumbHost.cloneNode(true) as HTMLElement;
    Object.assign(clone.style, {
      flex: '0 0 36px',
      width: '36px',
      height: '36px',
      overflow: 'hidden',
      borderRadius: '6px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });
    clone.querySelectorAll('img, video').forEach((media) => {
      const el = media as HTMLElement;
      el.style.width = '36px';
      el.style.height = '36px';
      el.style.objectFit = 'cover';
    });
    clone.querySelectorAll('svg').forEach((svg) => {
      svg.setAttribute('width', '28');
      svg.setAttribute('height', '28');
      (svg as SVGElement).style.width = '28px';
      (svg as SVGElement).style.height = '28px';
    });
    ghost.appendChild(clone);
  }

  const label = document.createElement('span');
  Object.assign(label.style, {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: '0',
  });
  label.textContent = count > 1 ? `${node.name} (+${count - 1})` : node.name;
  ghost.appendChild(label);

  document.body.appendChild(ghost);
  const offsetX = 22;
  const offsetY = Math.max(12, Math.round(ghost.offsetHeight / 2));
  try {
    e.dataTransfer.setDragImage(ghost, offsetX, offsetY);
  } catch {
    /* some browsers reject custom drag images */
  }
  requestAnimationFrame(() => ghost.remove());
}

export type UseFileDnDParams = {
  selected: Set<string>;
  browsing: boolean;
  parentId: string | null;
  onUpload: (files: FileList | File[] | null, intoParent?: string | null) => void | Promise<void>;
  moveNodesInto: (ids: string[], targetParent: string | null) => Promise<void>;
};

export function useFileDnD({
  selected,
  browsing,
  parentId,
  onUpload,
  moveNodesInto,
}: UseFileDnDParams) {
  const [dragging, setDragging] = useState(false);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const dragDepth = useRef(0);
  const suppressOpenAfterDrag = useRef(false);

  function hasOsFiles(e: DragEvent) {
    return Array.from(e.dataTransfer.types).includes('Files');
  }

  function hasInternalNodes(e: DragEvent) {
    return Array.from(e.dataTransfer.types).includes(DRAG_MIME);
  }

  function onDragStartNode(e: DragEvent, node: Node) {
    // Avoid setState here — selecting mid-dragstart re-renders and cancels the drag,
    // which forced a select-then-drag-again workflow.
    const ids = selected.has(node.id) && selected.size > 0 ? [...selected] : [node.id];
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
    suppressOpenAfterDrag.current = true;
    setCompactDragGhost(e, node, ids.length);
  }

  function onDragEndNode() {
    setDropTargetId(null);
    document.querySelectorAll('[data-arkive-drag-ghost]').forEach((n) => n.remove());
    window.setTimeout(() => {
      suppressOpenAfterDrag.current = false;
    }, 0);
  }

  function onDragOverFolder(e: DragEvent, folder: Node) {
    if (folder.kind !== 'folder') return;
    if (!hasOsFiles(e) && !hasInternalNodes(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = hasOsFiles(e) ? 'copy' : 'move';
    setDropTargetId(folder.id);
  }

  function onDragLeaveFolder(folder: Node) {
    setDropTargetId((cur) => (cur === folder.id ? null : cur));
  }

  async function onDropOnFolder(e: DragEvent, folder: Node) {
    if (folder.kind !== 'folder') return;
    e.preventDefault();
    e.stopPropagation();
    setDropTargetId(null);
    setDragging(false);
    dragDepth.current = 0;

    if (hasOsFiles(e) && e.dataTransfer.files.length) {
      void onUpload(e.dataTransfer.files, folder.id);
      return;
    }
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    try {
      const ids = JSON.parse(raw) as string[];
      if (!Array.isArray(ids) || !ids.length) return;
      if (ids.includes(folder.id)) return;
      await moveNodesInto(ids, folder.id);
    } catch {
      /* ignore bad payload */
    }
  }

  async function onDropOnBreadcrumb(e: DragEvent, targetParent: string | null) {
    e.preventDefault();
    e.stopPropagation();
    setDropTargetId(null);
    if (hasOsFiles(e) && e.dataTransfer.files.length) {
      void onUpload(e.dataTransfer.files, targetParent);
      return;
    }
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    try {
      const ids = JSON.parse(raw) as string[];
      if (!Array.isArray(ids) || !ids.length) return;
      await moveNodesInto(ids, targetParent);
    } catch {
      /* ignore */
    }
  }

  function onRootDragEnter(e: DragEvent) {
    if (!browsing) return;
    if (!hasOsFiles(e) && !hasInternalNodes(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    if (hasOsFiles(e)) setDragging(true);
  }

  function onRootDragOver(e: DragEvent) {
    if (!browsing) return;
    if (!hasOsFiles(e) && !hasInternalNodes(e)) return;
    e.preventDefault();
  }

  function onRootDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function onRootDrop(e: DragEvent) {
    if (!browsing) return;
    e.preventDefault();
    setDragging(false);
    dragDepth.current = 0;
    setDropTargetId(null);
    if (hasOsFiles(e) && e.dataTransfer.files.length) {
      void onUpload(e.dataTransfer.files, parentId);
    }
  }

  return {
    dragging,
    setDragging,
    dropTargetId,
    setDropTargetId,
    dragDepth,
    suppressOpenAfterDrag,
    hasOsFiles,
    hasInternalNodes,
    onDragStartNode,
    onDragEndNode,
    onDragOverFolder,
    onDragLeaveFolder,
    onDropOnFolder,
    onDropOnBreadcrumb,
    onRootDragEnter,
    onRootDragOver,
    onRootDragLeave,
    onRootDrop,
  };
}
