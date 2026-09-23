import { useCallback, useMemo, useRef, useState } from 'react';
import { rangeSelect } from '../../lib/access';

export type SelectModifiers = { shift?: boolean; toggle?: boolean };

/**
 * Selection model for file lists: a set of ids, an anchor for Shift-range
 * selection and a keyboard cursor (the "focused" row).
 */
export function useSelection(orderedIds: string[]) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const idsRef = useRef(orderedIds);
  idsRef.current = orderedIds;

  const select = useCallback((id: string, mods: SelectModifiers = {}) => {
    const ids = idsRef.current;
    setCursor(id);
    if (mods.shift && anchor.current && ids.includes(anchor.current)) {
      const range = rangeSelect(ids, anchor.current, id);
      setSelected((prev) => (mods.toggle ? new Set([...prev, ...range]) : new Set(range)));
      return;
    }
    anchor.current = id;
    if (mods.toggle) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setSelected(new Set([id]));
    }
  }, []);

  const toggle = useCallback((id: string) => select(id, { toggle: true }), [select]);

  const selectAll = useCallback(() => {
    setSelected(new Set(idsRef.current));
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
    anchor.current = null;
  }, []);

  /** Keep only ids that still exist (after reloads). */
  const prune = useCallback((existing: Set<string>) => {
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (existing.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
    setCursor((c) => (c && !existing.has(c) ? null : c));
  }, []);

  /** Move the cursor by `delta` rows; with `extend`, grow the selection from the anchor. */
  const moveCursor = useCallback(
    (delta: number, extend = false) => {
      const ids = idsRef.current;
      if (ids.length === 0) return null;
      const cur = cursor ? ids.indexOf(cursor) : -1;
      let idx = cur < 0 ? (delta > 0 ? 0 : ids.length - 1) : cur + delta;
      idx = Math.max(0, Math.min(ids.length - 1, idx));
      const id = ids[idx];
      if (extend) select(id, { shift: true });
      else {
        setCursor(id);
        anchor.current = id;
        setSelected(new Set([id]));
      }
      return id;
    },
    [cursor, select],
  );

  const moveCursorTo = useCallback(
    (index: number, extend = false) => {
      const ids = idsRef.current;
      if (!ids.length) return null;
      const id = ids[Math.max(0, Math.min(ids.length - 1, index))];
      if (extend) select(id, { shift: true });
      else {
        setCursor(id);
        anchor.current = id;
        setSelected(new Set([id]));
      }
      return id;
    },
    [select],
  );

  return useMemo(
    () => ({ selected, setSelected, cursor, setCursor, select, toggle, selectAll, clear, prune, moveCursor, moveCursorTo }),
    [selected, cursor, select, toggle, selectAll, clear, prune, moveCursor, moveCursorTo],
  );
}

export type Selection = ReturnType<typeof useSelection>;
