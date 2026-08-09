import { useEffect, useState, type FormEvent } from 'react';
import { api, type PublicLink, type Share, type Workspace } from '../lib/api';
import { useConfirm } from '../lib/confirm';

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
      const body: { password?: string; expires_at?: string | null } = {};
      if (linkPassword) body.password = linkPassword;
      if (linkExpiry) body.expires_at = new Date(linkExpiry).toISOString();
      const link = await api.createLink(nodeId, body);
      setLinkPassword('');
      setLinkExpiry('');
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
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl border border-arkive-border bg-arkive-surface p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold">Share</h2>
            <p className="text-sm text-arkive-muted">{nodeName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-arkive-muted hover:bg-arkive-panel hover:text-arkive-text"
          >
            Close
          </button>
        </div>

        <form onSubmit={onSubmit} className="mb-5 space-y-3">
          <h3 className="text-sm font-semibold text-arkive-amber">People & teams</h3>
          <label className="block text-sm">
            <span className="mb-1 block text-arkive-muted">User email</span>
            <input
              type="email"
              value={email}
              disabled={!!teamId}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2 outline-none focus:ring-2 focus:ring-arkive-amber/40 disabled:opacity-50"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-arkive-muted">Or team</span>
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2 outline-none focus:ring-2 focus:ring-arkive-amber/40"
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
            <span className="mb-1 block text-arkive-muted">Permission</span>
            <select
              value={permission}
              onChange={(e) => setPermission(e.target.value as 'read' | 'write')}
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2 outline-none focus:ring-2 focus:ring-arkive-amber/40"
            >
              <option value="read">Read</option>
              <option value="write">Write</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={busy || (!email && !teamId)}
            className="rounded-lg bg-gradient-to-r from-arkive-orange to-arkive-amber px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
          >
            Add share
          </button>
        </form>

        <ul className="mb-6 max-h-40 space-y-2 overflow-auto">
          {shares.length === 0 && (
            <li className="text-sm text-arkive-muted">No internal shares yet.</li>
          )}
          {shares.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-arkive-border bg-arkive-panel/50 px-3 py-2 text-sm"
            >
              <div>
                <div className="font-medium">{s.grantee_name || s.grantee_email || 'Share'}</div>
                <div className="text-arkive-muted">
                  {s.grantee_email || 'Team'} · {s.permission}
                </div>
              </div>
              <button
                type="button"
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
                className="text-arkive-muted hover:text-red-300"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={createLink} className="mb-4 space-y-3 border-t border-arkive-border pt-5">
          <h3 className="text-sm font-semibold text-arkive-amber">Public link</h3>
          <label className="block text-sm">
            <span className="mb-1 block text-arkive-muted">Password (optional)</span>
            <input
              type="password"
              value={linkPassword}
              onChange={(e) => setLinkPassword(e.target.value)}
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-arkive-muted">Expires (optional)</span>
            <input
              type="datetime-local"
              value={linkExpiry}
              onChange={(e) => setLinkExpiry(e.target.value)}
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg border border-arkive-border px-4 py-2 text-sm hover:border-arkive-amber/40 disabled:opacity-50"
          >
            Create link & copy
          </button>
        </form>

        <ul className="max-h-40 space-y-2 overflow-auto">
          {links.map((l) => (
            <li
              key={l.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-arkive-border bg-arkive-panel/50 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate font-mono text-xs text-arkive-glow">
                  {window.location.origin}
                  {l.url}
                </div>
                <div className="text-arkive-muted">
                  {l.has_password ? 'password' : 'open'}
                  {l.expires_at ? ` · expires ${new Date(l.expires_at).toLocaleString()}` : ''}
                  {copied === l.id ? ' · copied' : ''}
                </div>
              </div>
              <button
                type="button"
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
                className="text-arkive-muted hover:text-red-300"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>

        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </div>
      {confirmDialog}
    </div>
  );
}
