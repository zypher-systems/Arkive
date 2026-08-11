import { useState, type MouseEvent } from 'react';

export type UseSelectionParams = {
  showToast: (message: string, ms?: number) => void;
};

export function useSelection({ showToast }: UseSelectionParams) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<string[] | null>(null);

  function toggleSelect(id: string, e: MouseEvent) {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
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
