import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Breadcrumb, type Node } from '../../lib/api';
import { t } from '../../i18n';

function isAbort(e: unknown) {
  return (e instanceof DOMException || e instanceof Error) && e.name === 'AbortError';
}

/** Loads one folder listing (all pages) with abort-on-change and silent reloads. */
export function useFolder(workspaceId: string | undefined, parentId: string | null) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<number | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const keyRef = useRef('');

  const load = useCallback(
    async (silent = false) => {
      if (!workspaceId) return;
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      const key = `${workspaceId}|${parentId || ''}`;
      if (!silent || keyRef.current !== key) setLoading(true);
      keyRef.current = key;
      try {
        const data = await api.listNodes(workspaceId, parentId, { signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        setNodes(data.nodes);
        setBreadcrumbs(data.breadcrumbs);
        setError('');
        setStatus(null);
      } catch (e) {
        if (isAbort(e)) return;
        setError(e instanceof Error && e.message ? e.message : t('files.loadFailed'));
        setStatus((e as { status?: number }).status ?? 0);
        if (!silent) setNodes([]);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    },
    [workspaceId, parentId],
  );

  useEffect(() => {
    setNodes([]);
    setBreadcrumbs([]);
    void load();
    return () => ctrlRef.current?.abort();
  }, [load]);

  return { nodes, setNodes, breadcrumbs, loading, error, status, reload: load };
}
