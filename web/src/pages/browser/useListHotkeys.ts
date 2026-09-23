import { useEffect } from 'react';
import type { Node } from '../../lib/api';
import { isMac, isTypingTarget, useLatest } from '../../lib/hooks';
import type { Selection } from './useSelection';

export type ListHotkeyHandlers = {
  open: (n: Node) => void;
  menu?: (n: Node) => void;
  rename?: (n: Node) => void;
  trash?: (ns: Node[]) => void;
  copy?: (ns: Node[]) => void;
  paste?: () => void;
  newFolder?: () => void;
  toggleDetails?: () => void;
  up?: () => void;
};

/**
 * File-manager keyboard model: arrows move the cursor (Shift extends),
 * Enter opens, Space toggles, ⌘/Ctrl+A selects all, F2 renames, Delete
 * trashes, i toggles details, Backspace goes to the parent folder.
 * Disabled while typing or when any dialog is open.
 */
export function useListHotkeys({
  nodes,
  selection,
  columns = 1,
  handlers,
  enabled = true,
}: {
  nodes: Node[];
  selection: Selection;
  columns?: number;
  handlers: ListHotkeyHandlers;
  enabled?: boolean;
}) {
  const ref = useLatest({ nodes, selection, columns, handlers });

  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const { nodes, selection, columns, handlers: h } = ref.current;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const selectedNodes = nodes.filter((n) => selection.selected.has(n.id));
      const cursorNode = nodes.find((n) => n.id === selection.cursor) || selectedNodes[0];
      const target = e.target as HTMLElement;
      // Let focused buttons/links handle their own Enter/Space.
      const onControl = !!target.closest?.('button, a, [role="menuitem"], [role="tab"], summary');

      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowUp':
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (onControl && !target.closest('[role="listbox"]')) return;
          if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && columns <= 1) return;
          e.preventDefault();
          const delta =
            e.key === 'ArrowDown' ? columns : e.key === 'ArrowUp' ? -columns : e.key === 'ArrowRight' ? 1 : -1;
          selection.moveCursor(delta, e.shiftKey);
          focusList();
          return;
        }
        case 'Home':
        case 'End':
          if (onControl) return;
          e.preventDefault();
          selection.moveCursorTo(e.key === 'Home' ? 0 : nodes.length - 1, e.shiftKey);
          focusList();
          return;
        case 'Enter':
          if (onControl || !cursorNode) return;
          e.preventDefault();
          h.open(cursorNode);
          return;
        case ' ':
          if (onControl || !selection.cursor) return;
          e.preventDefault();
          selection.toggle(selection.cursor);
          return;
        case 'Escape':
          if (selection.selected.size) {
            e.preventDefault();
            selection.clear();
          }
          return;
        case 'F2':
          if (h.rename && selectedNodes.length === 1) {
            e.preventDefault();
            h.rename(selectedNodes[0]);
          }
          return;
        case 'Delete':
          if (h.trash && selectedNodes.length) {
            e.preventDefault();
            h.trash(selectedNodes);
          }
          return;
        case 'Backspace':
          if (isMac && e.metaKey && h.trash && selectedNodes.length) {
            e.preventDefault();
            h.trash(selectedNodes);
          } else if (!e.metaKey && !e.ctrlKey && h.up) {
            e.preventDefault();
            h.up();
          }
          return;
        case 'ContextMenu':
          if (h.menu && cursorNode) {
            e.preventDefault();
            h.menu(cursorNode);
          }
          return;
        case 'F10':
          if (e.shiftKey && h.menu && cursorNode) {
            e.preventDefault();
            h.menu(cursorNode);
          }
          return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selection.selectAll();
      } else if (mod && e.key.toLowerCase() === 'c' && h.copy && selectedNodes.length && !window.getSelection()?.toString()) {
        e.preventDefault();
        h.copy(selectedNodes);
      } else if (mod && e.key.toLowerCase() === 'v' && h.paste) {
        e.preventDefault();
        h.paste();
      } else if (!mod && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'n' && h.newFolder) {
        e.preventDefault();
        h.newFolder();
      } else if (!mod && !e.altKey && !e.shiftKey && e.key === 'i' && h.toggleDetails) {
        e.preventDefault();
        h.toggleDetails();
      }
    }
    function focusList() {
      const list = document.querySelector<HTMLElement>('#main [role="listbox"]');
      if (list && document.activeElement !== list) list.focus({ preventScroll: true });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, ref]);
}
