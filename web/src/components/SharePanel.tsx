import { useEffect, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  Check,
  Copy,
  Link2,
  Loader2,
  Lock,
  Share2,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { api, type PublicLink, type Share, type Workspace } from '../lib/api';
import { useConfirm } from '../lib/confirm';
import { Button, IconButton } from './ui/Button';

type Props = {
  nodeId: string;
  nodeName: string;
  workspaces: Workspace[];
  onClose: () => void;
};

export function SharePanel({ nodeId, nodeName, workspaces, onClose }: Props) {
  const [shares, setShares] = useState<Share[]>([]);
  const [links, setLinks] = useState<PublicLink[]>([]);
  const [email, setEmail] = useState('');
  const [teamId, setTeamId] = useState('');
  const [permission, setPermission] = useState<'read' | 'write'>('read');
  const [linkPassword, setLinkPassword] = useState('');
  const [linkExpiry, setLinkExpiry] = useState('');
  const [linkMaxDownloads, setLinkMaxDownloads] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const { ask, dialog: confirmDialog } = useConfirm();

  async function load() {
    const [s, l] = await Promise.all([api.shares(nodeId), api.links(nodeId)]);
    setShares(s);
    setLinks(l);
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load shares'));
  }, [nodeId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (teamId) {
        await api.createShare(nodeId, { grantee_workspace_id: teamId, permission });
      } else {
        await api.createShare(nodeId, { grantee_email: email, permission });
      }
      setEmail('');
      setTeamId('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Share failed');
    } finally {
      setBusy(false);
    }
  }

  async function createLink(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body: {
        password?: string;
        expires_at?: string | null;
        max_downloads?: number | null;
      } = {};
      if (linkPassword) body.password = linkPassword;
      if (linkExpiry) body.expires_at = new Date(linkExpiry).toISOString();
      if (linkMaxDownloads.trim()) {
        const n = Number(linkMaxDownloads);
        if (!Number.isInteger(n) || n <= 0) {
          setError('Max downloads must be a positive whole number');
          setBusy(false);
          return;
        }
        body.max_downloads = n;
      }
      const link = await api.createLink(nodeId, body);
      setLinkPassword('');
      setLinkExpiry('');
      setLinkMaxDownloads('');
      await load();
      const url = `${window.location.origin}${link.url}`;
      await navigator.clipboard.writeText(url);
      setCopied(link.id);
      setTimeout(() => setCopied(''), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Link failed');
    } finally {
      setBusy(false);
    }
  }

  const teams = workspaces.filter((w) => w.type === 'team');

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
              <Share2 size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-xl font-bold tracking-tight">Share</h2>
              <p className="truncate text-sm text-arkive-muted">{nodeName}</p>
            </div>
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>

        <form onSubmit={onSubmit} className="mb-6 space-y-3">
          <h3 className="flex items-center gap-2 text-xs font-bold tracking-[0.12em] text-arkive-muted uppercase">
            <Users size={13} className="text-arkive-accent2" /> People & teams
          </h3>
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-arkive-muted">User email</span>
            <input
              type="email"
              value={email}
              disabled={!!teamId}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
              className="input-glass disabled:opacity-50"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium text-arkive-muted">Or team</span>
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="input-glass cursor-pointer [&>option]:bg-arkive-surface"
              >
                <option value="">— none —</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium text-arkive-muted">Permission</span>
              <select
                value={permission}
                onChange={(e) => setPermission(e.target.value as 'read' | 'write')}
                className="input-glass cursor-pointer [&>option]:bg-arkive-surface"
              >
                <option value="read">Read</option>
                <option value="write">Write</option>
              </select>
            </label>
          </div>
          <Button
            type="submit"
            variant="primary"
            className="font-semibold"
            disabled={busy || (!email && !teamId)}
            icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
          >
            Add share
          </Button>
        </form>

        <ul className="scroll-slim mb-6 max-h-40 space-y-2 overflow-auto">
          {shares.length === 0 && (
            <li className="text-sm text-arkive-muted">No internal shares yet.</li>
          )}
          {shares.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-2 rounded-2xl border border-white/7 bg-white/[0.035] px-3.5 py-2.5 text-sm transition hover:border-white/12 hover:bg-white/[0.05]"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-arkive-accent/30 to-arkive-accent2/20 text-xs font-bold text-white ring-1 ring-white/10">
                  {(s.grantee_name || s.grantee_email || '?').trim().charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-medium">{s.grantee_name || s.grantee_email || 'Share'}</div>
                  <div className="truncate text-xs text-arkive-muted">
                    {s.grantee_email || 'Team'} ·{' '}
                    <span className={s.permission === 'write' ? 'text-arkive-accent2' : ''}>
                      {s.permission}
                    </span>
                  </div>
                </div>
              </div>
              <Button
                size="xs"
                variant="ghost"
                icon={<Trash2 size={12} />}
                className="hover:!bg-red-500/12 hover:!text-red-300"
                onClick={() =>
                  ask({
                    title: 'Revoke share',
                    message: `Revoke access for ${s.grantee_name || s.grantee_email || 'this share'}?`,
                    confirmLabel: 'Revoke',
                    run: async () => {
                      try {
                        await api.deleteShare(s.id);
                        await load();
                      } catch (e) {
                        setError(String(e));
                        throw e;
                      }
                    },
                  })
                }
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>

        <form onSubmit={createLink} className="mb-5 space-y-3 border-t border-white/6 pt-5">
          <h3 className="flex items-center gap-2 text-xs font-bold tracking-[0.12em] text-arkive-muted uppercase">
            <Link2 size={13} className="text-arkive-accent2" /> Public link
          </h3>
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-arkive-muted">Password (optional)</span>
            <input
              type="password"
              value={linkPassword}
              onChange={(e) => setLinkPassword(e.target.value)}
              className="input-glass"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium text-arkive-muted">Expires (optional)</span>
              <input
                type="datetime-local"
                value={linkExpiry}
                onChange={(e) => setLinkExpiry(e.target.value)}
                className="input-glass [color-scheme:dark]"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium text-arkive-muted">Max downloads</span>
              <input
                type="number"
                min={1}
                value={linkMaxDownloads}
                onChange={(e) => setLinkMaxDownloads(e.target.value)}
                placeholder="unlimited"
                className="input-glass"
              />
            </label>
          </div>
          <Button
            type="submit"
            variant="glass"
            disabled={busy}
            icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
          >
            Create link & copy
          </Button>
        </form>

        <ul className="scroll-slim max-h-40 space-y-2 overflow-auto">
          {links.map((l) => (
            <li
              key={l.id}
              className="flex items-center justify-between gap-2 rounded-2xl border border-white/7 bg-white/[0.035] px-3.5 py-2.5 text-sm transition hover:border-white/12 hover:bg-white/[0.05]"
            >
              <div className="min-w-0">
                <div className="truncate font-mono text-xs text-arkive-accent2">
                  {window.location.origin}
                  {l.url}
                </div>
                <div className="flex items-center gap-1 text-xs text-arkive-muted">
                  {l.has_password ? (
                    <span className="inline-flex items-center gap-0.5">
                      <Lock size={10} /> password
                    </span>
                  ) : (
                    'open'
                  )}
                  <span>
                    {l.expires_at ? ` · expires ${new Date(l.expires_at).toLocaleString()}` : ''}
                    {l.max_downloads != null
                      ? ` · ${l.download_count ?? 0}/${l.max_downloads} downloads`
                      : l.download_count
                        ? ` · ${l.download_count} downloads`
                        : ''}
                  </span>
                  {copied === l.id && (
                    <span className="inline-flex items-center gap-0.5 text-emerald-300">
                      <Check size={11} /> copied
                    </span>
                  )}
                </div>
              </div>
              <Button
                size="xs"
                variant="ghost"
                icon={<Trash2 size={12} />}
                className="hover:!bg-red-500/12 hover:!text-red-300"
                onClick={() =>
                  ask({
                    title: 'Revoke link',
                    message: 'Revoke this public link? Anyone with the URL will lose access.',
                    confirmLabel: 'Revoke',
                    run: async () => {
                      try {
                        await api.deleteLink(l.id);
                        await load();
                      } catch (e) {
                        setError(String(e));
                        throw e;
                      }
                    },
                  })
                }
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>

        {error && (
          <p className="mt-3 flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            <AlertCircle size={14} className="shrink-0" />
            {error}
          </p>
        )}
      </motion.div>
      {confirmDialog}
    </div>
  );
}
