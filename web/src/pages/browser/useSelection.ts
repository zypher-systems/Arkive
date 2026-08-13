import { useState, type MouseEvent } from 'react';
import { rangeSelect } from '../../lib/access';

export type UseSelectionParams = {
  showToast: (message: string, ms?: number) => void;
};

export function useSelection({ showToast }: UseSelectionParams) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<string[] | null>(null);
  const [anchorId, setAnchorId] = useState<string | null>(null);

  function toggleSelect(id: string, e: MouseEvent, orderedIds: string[] = []) {
    e.stopPropagation();
    if (e.shiftKey && anchorId && orderedIds.length) {
      setSelected(new Set(rangeSelect(orderedIds, anchorId, id)));
      return;
    }
    setAnchorId(id);
    setSelected((prev) => {
      const next = new Set(e.ctrlKey || e.metaKey ? prev : new Set<string>());
      if (e.ctrlKey || e.metaKey) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function copyToClipboard(ids: string[]) {
    if (!ids.length) return;
    setClipboard(ids);
    showToast(
      ids.length > 1
        ? `Copied ${ids.length} items — Paste in a folder`
        : 'Copied — Paste in a folder',
    );
  }

  return {
    selected,
    setSelected,
    clipboard,
    setClipboard,
    toggleSelect,
    copyToClipboard,
  };
}
