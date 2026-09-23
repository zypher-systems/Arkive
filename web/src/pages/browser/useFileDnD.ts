import { useCallback, useRef, useState, type DragEvent } from 'react';
import type { RowDnD } from '../../components/files/FileList';
import { collectDrop, dragHasFiles } from '../../lib/dropFiles';
import type { UploadEngine, UploadTarget } from '../../lib/uploads';

export const DRAG_MIME = 'application/x-arkive-nodes';

function hasNodes(e: DragEvent) {
  return Array.from(e.dataTransfer.types).includes(DRAG_MIME);
}

/** Compact translucent chip used as the drag image. */
function setDragGhost(e: DragEvent, label: string) {
  document.querySelectorAll('[data-arkive-drag-ghost]').forEach((n) => n.remove());
  const ghost = document.createElement('div');
  ghost.setAttribute('data-arkive-drag-ghost', '1');
  const cs = getComputedStyle(document.documentElement);
  Object.assign(ghost.style, {
    position: 'fixed',
    top: '-1000px',
    left: '0',
    padding: '8px 14px',
    maxWidth: '280px',
    borderRadius: '10px',
    background: cs.getPropertyValue('--primary').trim() || '#22252a',
    color: cs.getPropertyValue('--primary-fg').trim() || '#fff',
    font: '600 13px/1.3 "Inter Variable", system-ui, sans-serif',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    boxShadow: '0 8px 24px rgba(0,0,0,.25)',
  } as Partial<CSSStyleDeclaration>);
  ghost.textContent = label;
  document.body.appendChild(ghost);
  try {
    e.dataTransfer.setDragImage(ghost, 16, 16);
  } catch {
    /* ignore */
  }
  requestAnimationFrame(() => ghost.remove());
}

/**
 * Drag & drop inside the file browser: drag selected items onto folders or
 * breadcrumbs to move them; drop OS files/folders onto a folder row to
 * upload straight into it.
 */
export function useFileDnD({
  enabled,
  selected,
  workspaceId,
  engine,
  moveInto,
  labelFor,
}: {
  enabled: boolean;
  selected: Set<string>;
  workspaceId?: string;
  engine: UploadEngine;
  moveInto: (ids: string[], target: string | null) => Promise<void>;
  labelFor: (count: number, first: string) => string;
}) {
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const dragging = useRef(false);

  const acceptDrop = useCallback(
    async (e: DragEvent, targetId: string | null, targetLabel: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTargetId(null);
      if (dragHasFiles(e.dataTransfer)) {
        if (!workspaceId) return;
        const target: UploadTarget = { workspaceId, parentId: targetId, label: targetLabel };
        const files = await collectDrop(e.dataTransfer);
        if (files.length) engine.enqueue(files, target);
        return;
      }
      const raw = e.dataTransfer.getData(DRAG_MIME);
      if (!raw) return;
      try {
        const ids = JSON.parse(raw) as string[];
        if (Array.isArray(ids) && ids.length && !(targetId && ids.includes(targetId))) await moveInto(ids, targetId);
      } catch {
        /* ignore malformed payloads */
      }
    },
    [workspaceId, engine, moveInto],
  );

  const row: RowDnD = {
    draggable: enabled,
    dropTargetId,
    onDragStart: (e, node) => {
      const ids = selected.has(node.id) ? [...selected] : [node.id];
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'move';
      dragging.current = true;
      setDragGhost(e, labelFor(ids.length, node.name));
    },
    onDragEnd: () => {
      dragging.current = false;
      setDropTargetId(null);
    },
    onDragOver: (e, node) => {
      if (!enabled || node.kind !== 'folder') return;
      if (!dragHasFiles(e.dataTransfer) && !hasNodes(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = dragHasFiles(e.dataTransfer) ? 'copy' : 'move';
      setDropTargetId(node.id);
    },
    onDragLeave: (node) => setDropTargetId((cur) => (cur === node.id ? null : cur)),
    onDrop: (e, node) => {
      if (!enabled || node.kind !== 'folder') return;
      void acceptDrop(e, node.id, node.name);
    },
  };

  const crumb = {
    dropTargetId,
    onDragOverCrumb: (e: DragEvent, id: string | null) => {
      if (!enabled) return;
      if (!dragHasFiles(e.dataTransfer) && !hasNodes(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setDropTargetId(id ?? '__root__');
    },
    onDragLeaveCrumb: (id: string | null) => setDropTargetId((cur) => (cur === (id ?? '__root__') ? null : cur)),
    onDrop: (e: DragEvent, id: string | null, label = '') => {
      if (!enabled) return;
      void acceptDrop(e, id, label);
    },
  };

  return { row, crumb };
}
