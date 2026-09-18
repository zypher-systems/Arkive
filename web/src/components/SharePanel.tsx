import { useEffect, useState, type FormEvent } from 'react';
import { CheckIcon, CopyIcon, LockIcon, SpinnerIcon } from './icons';
import { api, type PublicLink, type Share, type Workspace } from '../lib/api';
import { useConfirm } from '../lib/confirm';
import { Button } from './ui/Button';
import { Modal, ModalField } from './ui/Modal';
import { Notice } from './ui/Notice';

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
    <>
      <Modal title="Share" subtitle={nodeName} onClose={onClose} width="max-w-lg">
        <div className="space-y-6">
          <form onSubmit={onSubmit} className="space-y-3">
            <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
              People &amp; teams
            </h3>
            <ModalField label="User email">
              <input
                type="email"
                value={email}
                disabled={!!teamId}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@example.com"
                className="input-field"
              />
            </ModalField>
            <div className="grid grid-cols-2 gap-3">
              <ModalField label="Or team">
                <select
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                  className="input-field cursor-pointer"
                >
                  <option value="">— none —</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </ModalField>
              <ModalField label="Permission">
                <select
                  value={permission}
                  onChange={(e) => setPermission(e.target.value as 'read' | 'write')}
                  className="input-field cursor-pointer"
                >
                  <option value="read">Read</option>
                  <option value="write">Write</option>
                </select>
              </ModalField>
            </div>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || (!email && !teamId)}
              icon={busy ? <SpinnerIcon size={13} className="animate-spin" /> : undefined}
            >
              Add share
            </Button>
          </form>

          <ul className="scroll-slim max-h-40 space-y-2 overflow-auto">
            {shares.length === 0 && (
              <li className="text-sm text-muted">No internal shares yet.</li>
            )}
            {shares.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-md border border-line bg-inset px-3 py-2 text-sm"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-hover text-xs font-semibold text-muted">
                    {(s.grantee_name || s.grantee_email || '?').trim().charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{s.grantee_name || s.grantee_email || 'Share'}</div>
                    <div className="truncate text-xs text-muted">
                      {s.grantee_email || 'Team'} ·{' '}
                      <span className={s.permission === 'write' ? 'text-accent-strong' : ''}>
                        {s.permission}
                      </span>
                    </div>
                  </div>
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  className="hover:!bg-danger-soft hover:!text-danger"
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

          <form onSubmit={createLink} className="space-y-3 border-t border-line pt-5">
            <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
              Public link
            </h3>
            <ModalField label="Password (optional)">
              <input
                type="password"
                value={linkPassword}
                onChange={(e) => setLinkPassword(e.target.value)}
                className="input-field"
              />
            </ModalField>
            <div className="grid grid-cols-2 gap-3">
              <ModalField label="Expires (optional)">
                <input
                  type="datetime-local"
                  value={linkExpiry}
                  onChange={(e) => setLinkExpiry(e.target.value)}
                  className="input-field"
                />
              </ModalField>
              <ModalField label="Max downloads">
                <input
                  type="number"
                  min={1}
                  value={linkMaxDownloads}
                  onChange={(e) => setLinkMaxDownloads(e.target.value)}
                  placeholder="unlimited"
                  className="input-field"
                />
              </ModalField>
            </div>
            <Button
              type="submit"
              variant="secondary"
              disabled={busy}
              icon={
                busy ? (
                  <SpinnerIcon size={13} className="animate-spin" />
                ) : (
                  <CopyIcon size={13} />
                )
              }
            >
              Create link &amp; copy
            </Button>
          </form>

          <ul className="scroll-slim max-h-40 space-y-2 overflow-auto">
            {links.map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between gap-2 rounded-md border border-line bg-inset px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs text-accent-strong">
                    {window.location.origin}
                    {l.url}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted">
                    {l.has_password ? (
                      <span className="inline-flex items-center gap-0.5">
                        <LockIcon size={10} /> password
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
                      <span className="inline-flex items-center gap-0.5 text-ok">
                        <CheckIcon size={11} /> copied
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  className="hover:!bg-danger-soft hover:!text-danger"
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

          {error && <Notice kind="error">{error}</Notice>}
        </div>
      </Modal>
      {confirmDialog}
    </>
  );
}
