import { useEffect, useState } from 'react';
import { DownloadIcon, RestoreIcon } from './icons';
import { api, formatBytes, type Node } from '../lib/api';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Notice } from './ui/Notice';

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
    <Modal title={node.name} subtitle="History" onClose={onClose} width="max-w-lg">
      <div className="space-y-6">
        {error && <Notice kind="error">{error}</Notice>}

        <section>
          <h3 className="mb-2.5 text-xs font-semibold tracking-wide text-muted uppercase">
            Versions
          </h3>
          <ul className="scroll-slim max-h-48 space-y-2 overflow-auto">
            {versions.length === 0 && (
              <li className="text-sm text-muted">No prior versions yet. Overwrite the file to create one.</li>
            )}
            {versions.map((v) => (
              <li
                key={v.version}
                className="flex items-center justify-between gap-2 rounded-md border border-line bg-inset px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-accent-strong">v{v.version}</div>
                  <div className="truncate text-xs text-muted">
                    {formatBytes(v.size)} · {new Date(v.created_at).toLocaleString()}
                    {v.created_by ? ` · ${v.created_by}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <a
                    href={`/api/nodes/${node.id}/versions/${v.version}/download`}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-muted transition hover:bg-hover hover:text-ink"
                  >
                    <DownloadIcon size={12} /> Download
                  </a>
                  <Button
                    size="xs"
                    variant="ghost"
                    icon={<RestoreIcon size={12} />}
                    onClick={() =>
                      void api
                        .restoreVersion(node.id, v.version)
                        .then(load)
                        .catch((e) => setError(String(e)))
                    }
                  >
                    Restore
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="mb-2.5 text-xs font-semibold tracking-wide text-muted uppercase">
            Activity
          </h3>
          <ul className="scroll-slim max-h-48 space-y-2 overflow-auto">
            {activity.length === 0 && (
              <li className="text-sm text-muted">No share/link activity yet.</li>
            )}
            {activity.map((a) => (
              <li
                key={a.id}
                className="rounded-md border border-line bg-inset px-3 py-2 text-sm"
              >
                <div className="font-medium">{a.action}</div>
                <div className="text-xs text-muted">
                  {a.actor || 'anonymous'} · {new Date(a.created_at).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  );
}
