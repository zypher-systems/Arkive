import { useEffect, useState } from 'react';
import { api, formatBytes, type Node } from '../lib/api';

type Props = {
  node: Node;
  onClose: () => void;
};

export function VersionsPanel({ node, onClose }: Props) {
  const [versions, setVersions] = useState<
    { version: number; size: number; created_at: string; created_by?: string }[]
  >([]);
  const [activity, setActivity] = useState<
    { id: string; action: string; actor?: string; created_at: string }[]
  >([]);
  const [error, setError] = useState('');

  async function load() {
    setVersions(await api.versions(node.id));
    setActivity(await api.activity(node.id));
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [node.id]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl border border-arkive-border bg-arkive-surface p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold">History</h2>
            <p className="text-sm text-arkive-muted">{node.name}</p>
          </div>
          <button type="button" onClick={onClose} className="text-arkive-muted hover:text-arkive-text">
            Close
          </button>
        </div>

        {error && <p className="mb-3 text-sm text-red-300">{error}</p>}

        <h3 className="mb-2 text-sm font-semibold text-arkive-amber">Versions</h3>
        <ul className="mb-6 max-h-48 space-y-2 overflow-auto">
          {versions.length === 0 && (
            <li className="text-sm text-arkive-muted">No prior versions yet. Overwrite the file to create one.</li>
          )}
          {versions.map((v) => (
            <li
              key={v.version}
              className="flex items-center justify-between gap-2 rounded-lg border border-arkive-border bg-arkive-panel/40 px-3 py-2 text-sm"
            >
              <div>
                <div className="font-medium">v{v.version}</div>
                <div className="text-xs text-arkive-muted">
                  {formatBytes(v.size)} · {new Date(v.created_at).toLocaleString()}
                  {v.created_by ? ` · ${v.created_by}` : ''}
                </div>
              </div>
              <div className="flex gap-2 text-xs">
                <a
                  href={`/api/nodes/${node.id}/versions/${v.version}/download`}
                  className="rounded-md border border-arkive-border px-2 py-1 hover:border-arkive-amber/40"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() =>
                    void api
                      .restoreVersion(node.id, v.version)
                      .then(load)
                      .catch((e) => setError(String(e)))
                  }
                  className="rounded-md border border-arkive-border px-2 py-1 hover:border-arkive-amber/40"
                >
                  Restore
                </button>
              </div>
            </li>
          ))}
        </ul>

        <h3 className="mb-2 text-sm font-semibold text-arkive-amber">Activity</h3>
        <ul className="max-h-48 space-y-2 overflow-auto">
          {activity.length === 0 && (
            <li className="text-sm text-arkive-muted">No share/link activity yet.</li>
          )}
          {activity.map((a) => (
            <li key={a.id} className="rounded-lg border border-arkive-border px-3 py-2 text-sm">
              <div className="font-medium">{a.action}</div>
              <div className="text-xs text-arkive-muted">
                {a.actor || 'anonymous'} · {new Date(a.created_at).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
