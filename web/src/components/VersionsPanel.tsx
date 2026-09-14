import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, AlertCircle, Download, GitCommitVertical, History, RotateCcw, X } from 'lucide-react';
import { api, formatBytes, type Node } from '../lib/api';
import { Button, IconButton } from './ui/Button';

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
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[#03040c]/70 p-4 backdrop-blur-md sm:items-center">
      <motion.div
        initial={{ opacity: 0, y: 32, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 360, damping: 30 }}
        className="glass-strong glass-hairline scroll-slim max-h-[90vh] w-full max-w-lg overflow-auto rounded-3xl p-6 shadow-[0_24px_80px_rgba(3,4,12,0.7)]"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-arkive-accent/25 to-arkive-accent2/20 text-arkive-accent2 ring-1 ring-white/10">
              <History size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-xl font-bold tracking-tight">History</h2>
              <p className="truncate text-sm text-arkive-muted">{node.name}</p>
            </div>
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>

        {error && (
          <p className="mb-3 flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            <AlertCircle size={14} className="shrink-0" />
            {error}
          </p>
        )}

        <h3 className="mb-2.5 flex items-center gap-2 text-xs font-bold tracking-[0.12em] text-arkive-muted uppercase">
          <GitCommitVertical size={13} className="text-arkive-accent2" /> Versions
        </h3>
        <ul className="scroll-slim mb-6 max-h-48 space-y-2 overflow-auto">
          {versions.length === 0 && (
            <li className="text-sm text-arkive-muted">No prior versions yet. Overwrite the file to create one.</li>
          )}
          {versions.map((v) => (
            <li
              key={v.version}
              className="flex items-center justify-between gap-2 rounded-2xl border border-white/7 bg-white/[0.035] px-3.5 py-2.5 text-sm transition hover:border-white/12 hover:bg-white/[0.05]"
            >
              <div className="min-w-0">
                <div className="font-display font-semibold text-arkive-accent2">v{v.version}</div>
                <div className="truncate text-xs text-arkive-muted">
                  {formatBytes(v.size)} · {new Date(v.created_at).toLocaleString()}
                  {v.created_by ? ` · ${v.created_by}` : ''}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <a
                  href={`/api/nodes/${node.id}/versions/${v.version}/download`}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-arkive-muted transition hover:bg-white/[0.07] hover:text-arkive-text"
                >
                  <Download size={12} /> Download
                </a>
                <Button
                  size="xs"
                  variant="ghost"
                  icon={<RotateCcw size={12} />}
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

        <h3 className="mb-2.5 flex items-center gap-2 text-xs font-bold tracking-[0.12em] text-arkive-muted uppercase">
          <Activity size={13} className="text-arkive-accent2" /> Activity
        </h3>
        <ul className="scroll-slim max-h-48 space-y-2 overflow-auto">
          {activity.length === 0 && (
            <li className="text-sm text-arkive-muted">No share/link activity yet.</li>
          )}
          {activity.map((a) => (
            <li
              key={a.id}
              className="rounded-2xl border border-white/7 bg-white/[0.035] px-3.5 py-2.5 text-sm"
            >
              <div className="font-medium">{a.action}</div>
              <div className="text-xs text-arkive-muted">
                {a.actor || 'anonymous'} · {new Date(a.created_at).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      </motion.div>
    </div>
  );
}
