import { useCallback, useState } from 'react';
import type { FileViewMode } from '../../components/files/types';
import { nextSort, parseSort, serializeSort, type SortKey, type SortSpec } from '../../lib/sort';

const VIEW_KEY = 'arkive.files.viewMode';
const SORT_KEY = 'arkive.files.sort';
const DETAILS_KEY = 'arkive.files.details';

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

export function useViewPrefs() {
  const [viewMode, setViewModeState] = useState<FileViewMode>(() => {
    const v = read(VIEW_KEY);
    return v === 'details' || v === 'tiles' || v === 'gallery' ? v : 'list';
  });
  const [sort, setSortState] = useState<SortSpec>(() => parseSort(read(SORT_KEY)));
  const [detailsOpen, setDetailsOpenState] = useState(() => read(DETAILS_KEY) === '1');

  const setViewMode = useCallback((m: FileViewMode) => {
    setViewModeState(m);
    write(VIEW_KEY, m);
  }, []);
  const setSort = useCallback((s: SortSpec) => {
    setSortState(s);
    write(SORT_KEY, serializeSort(s));
  }, []);
  const toggleSort = useCallback((key: SortKey) => {
    setSortState((cur) => {
      const next = nextSort(cur, key);
      write(SORT_KEY, serializeSort(next));
      return next;
    });
  }, []);
  const setDetailsOpen = useCallback((v: boolean) => {
    setDetailsOpenState(v);
    write(DETAILS_KEY, v ? '1' : '0');
  }, []);

  return { viewMode, setViewMode, sort, setSort, toggleSort, detailsOpen, setDetailsOpen };
}
