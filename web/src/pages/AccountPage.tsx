import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api, type StorageConnection, type Workspace } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useConfirm } from '../lib/confirm';

function davURL(workspaceId: string) {
  return `${window.location.origin}/dav/${workspaceId}/`;
}

function workspaceLabel(ws: Workspace) {
  if (ws.type === 'personal') return 'My files';
  if (ws.type === 'mount') return ws.name || 'Google Drive';
  return ws.name;
}

export function AccountPage() {
  const { user, setUser } = useAuth();
  const [params] = useSearchParams();
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [copied, setCopied] = useState('');
  const [gdriveEnabled, setGdriveEnabled] = useState(false);
  const [connections, setConnections] = useState<StorageConnection[]>([]);
  const [migrating, setMigrating] = useState('');
  const { ask, dialog: confirmDialog } = useConfirm();

  async function refreshStorage() {
    const [ws, conns, enabled] = await Promise.all([
      api.workspaces(),
      api.storageConnections().catch(() => [] as StorageConnection[]),
      api.googleDriveEnabled().catch(() => ({ enabled: false })),
    ]);
    setWorkspaces(ws);
    setConnections(conns);
    setGdriveEnabled(enabled.enabled);
  }

  useEffect(() => {
    void refreshStorage().catch(() => setWorkspaces([]));
  }, []);

  useEffect(() => {
    if (params.get('gdrive') === 'connected') {
      setMessage('Google Drive connected — open it under Files → Connected');
      void refreshStorage();
    }
    const err = params.get('error');
    if (err?.startsWith('gdrive')) {
      setError(`Google Drive connection failed (${err})`);
    }
  }, [params]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage('');
    setError('');
    try {
      const updated = await api.updateProfile(displayName, password || undefined);
      setUser(updated);
      setPassword('');
      setMessage('Saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function copyDav(ws: Workspace) {
    const url = davURL(ws.id);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(ws.id);
      setTimeout(() => setCopied((c) => (c === ws.id ? '' : c)), 2000);
    } catch {
      setError('Could not copy to clipboard');
    }
  }

  const gdrive = connections.find((c) => c.type === 'gdrive');
  const personal = workspaces.find((w) => w.type === 'personal');
  const driveMount =
    workspaces.find((w) => w.type === 'mount' && w.id === gdrive?.workspace_id) ||
    workspaces.find((w) => w.type === 'mount');

  async function runMigrate(
    key: string,
    workspaceId: string,
    body: { use_default?: boolean; storage_backend_id?: string },
    okMessage: string,
  ) {
    setMigrating(key);
    setError('');
    setMessage('Copying files…');
    try {
      const res = await api.migrateWorkspace(workspaceId, body);
      if (res.job?.id) {
        setMessage(`Migration queued (${res.job.total} objects)…`);
        for (let i = 0; i < 120; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const job = await api.migrationJob(res.job.id);
          if (job.status === 'completed') {
            setMessage(`${okMessage} (${job.copied}/${job.total} objects)`);
            break;
          }
          if (job.status === 'failed') {
            setError(job.error || 'Migration failed');
            break;
          }
          setMessage(`Migrating… ${job.copied}/${job.total}`);
        }
      } else {
        setMessage(
          res.migrated ? `${okMessage} (${res.copied}/${res.total} objects)` : okMessage,
        );
      }
      await refreshStorage();
    } catch (e) {
      setError(String(e));
    } finally {
      setMigrating('');
    }
  }

  const [webdavURL, setWebdavURL] = useState('');
  const [webdavUser, setWebdavUser] = useState('');
  const [webdavPass, setWebdavPass] = useState('');
  const [webdavType, setWebdavType] = useState<'webdav' | 'internxt'>('webdav');
  const [appPasswords, setAppPasswords] = useState<
    {
      id: string;
      name: string;
      prefix: string;
      created_at: string;
      last_used_at?: string | null;
    }[]
  >([]);
  const [tokenName, setTokenName] = useState('WebDAV');
  const [newSecret, setNewSecret] = useState('');
  const [tokenBusy, setTokenBusy] = useState(false);

  async function refreshAppPasswords() {
    const list = await api.listAppPasswords();
    setAppPasswords(list);
  }

  useEffect(() => {
    void refreshAppPasswords().catch(() => setAppPasswords([]));
  }, []);

  async function createAppPassword(e: FormEvent) {
    e.preventDefault();
    setTokenBusy(true);
    setError('');
    setMessage('');
    try {
      const created = await api.createAppPassword(tokenName.trim() || 'WebDAV');
      setNewSecret(created.secret);
      setTokenName('WebDAV');
      await refreshAppPasswords();
      setMessage('App password created — copy it now; it won’t be shown again.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create app password');
    } finally {
      setTokenBusy(false);
    }
  }

  function revokeAppPassword(id: string, name: string) {
    ask({
      title: 'Revoke app password?',
      message: `Revoke “${name}”? Mounts using this password will stop working.`,
      confirmLabel: 'Revoke',
      run: async () => {
        setError('');
        try {
          await api.revokeAppPassword(id);
          setNewSecret((prev) => {
            const prefix = appPasswords.find((p) => p.id === id)?.prefix;
            if (prefix && prev.includes(prefix)) return '';
            return prev;
          });
          await refreshAppPasswords();
          setMessage('App password revoked');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not revoke');
          throw err;
        }
      },
    });
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <h1 className="font-display text-3xl font-bold tracking-tight">Account</h1>
      <p className="mt-1 mb-6 text-sm text-arkive-muted">{user?.email}</p>

      <form
        onSubmit={onSubmit}
        className="mb-8 max-w-lg rounded-2xl border border-arkive-border bg-arkive-surface/70 p-5"
      >
        <label className="mb-3 block text-sm">
          <span className="mb-1.5 block text-arkive-muted">Display name</span>
          <input
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2.5 outline-none focus:ring-2 focus:ring-arkive-amber/40"
          />
        </label>
        <label className="mb-2 block text-sm">
          <span className="mb-1.5 block text-arkive-muted">New password (optional)</span>
          <input
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2.5 outline-none focus:ring-2 focus:ring-arkive-amber/40"
          />
        </label>
        <p className="mb-5 text-xs text-arkive-muted">
          Locked out? Use Forgot password on the sign-in page (requires SMTP under Admin).
        </p>
        {message && <p className="mb-3 text-sm text-arkive-glow">{message}</p>}
        {error && <p className="mb-3 text-sm text-red-300">{error}</p>}
        {user?.is_instance_admin && (
          <p className="mb-4 rounded-lg border border-arkive-amber/30 bg-arkive-amber/10 px-3 py-2 text-xs text-arkive-amber">
            Instance admin — approve users and manage storage under Admin.
          </p>
        )}
        <button
          type="submit"
          className="rounded-lg bg-gradient-to-r from-arkive-orange to-arkive-amber px-4 py-2 text-sm font-semibold text-black"
        >
          Save changes
        </button>
      </form>

      {gdriveEnabled && (
        <section className="mb-8 max-w-lg rounded-2xl border border-arkive-border bg-arkive-surface/70 p-5">
          <h2 className="font-display text-lg font-semibold">Google Drive</h2>
          <p className="mt-1 mb-4 text-xs text-arkive-muted">
            Connecting Drive adds a <span className="text-arkive-text">Connected</span> root in Files.
            Your personal vault stays on instance storage. Arkive folders, shares, and versions stay in
            Arkive; Drive holds opaque file bytes in a folder named Arkive.
          </p>
          {gdrive ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm">
              <div>
                <div className="font-medium">Connected</div>
                <div className="text-xs text-arkive-muted">{gdrive.account_email || gdrive.name}</div>
                {driveMount && (
                  <div className="mt-1 text-xs text-arkive-muted">
                    Open under Files → Connected → {workspaceLabel(driveMount)}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() =>
                  ask({
                    title: 'Disconnect Google Drive',
                    message:
                      'Disconnect Google Drive? Workspaces using this connection will fall back to instance storage. Blobs already in Drive are not deleted.',
                    confirmLabel: 'Disconnect',
                    run: async () => {
                      try {
                        await api.disconnectStorage(gdrive.id);
                        await refreshStorage();
                        setMessage('Google Drive disconnected');
                      } catch (e) {
                        setError(String(e));
                        throw e;
                      }
                    },
                  })
                }
                className="rounded-md border border-arkive-border px-2 py-1 text-xs hover:text-red-300"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <a
              href="/api/storage/google/start"
              className="mb-4 inline-flex rounded-lg border border-arkive-border px-3 py-2 text-sm font-medium hover:border-arkive-amber/50"
            >
              Connect Google Drive
            </a>
          )}

          {gdrive && personal && (
            <details className="rounded-lg border border-arkive-border bg-arkive-panel/40 px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">Advanced — copy storage</summary>
              <p className="mt-2 text-xs text-arkive-muted">
                Optionally move an entire vault’s blobs between instance storage and Drive. This changes
                where that root stores bytes; it does not merge folder trees.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <button
                  type="button"
                  disabled={!!migrating || personal.storage_backend_id === gdrive.id}
                  onClick={() =>
                    void runMigrate(
                      'personal-drive',
                      personal.id,
                      { storage_backend_id: gdrive.id },
                      'My files now store on Google Drive',
                    )
                  }
                  className="rounded-md border border-arkive-border px-2 py-1.5 text-left text-xs hover:border-arkive-amber/40 disabled:opacity-50"
                >
                  {migrating === 'personal-drive'
                    ? 'Copying…'
                    : 'Copy My files → Drive storage'}
                </button>
                <button
                  type="button"
                  disabled={!!migrating}
                  onClick={() =>
                    void runMigrate(
                      'personal-default',
                      personal.id,
                      { use_default: true },
                      'My files now store on instance storage',
                    )
                  }
                  className="rounded-md border border-arkive-border px-2 py-1.5 text-left text-xs hover:border-arkive-amber/40 disabled:opacity-50"
                >
                  {migrating === 'personal-default'
                    ? 'Copying…'
                    : 'Copy My files → instance storage'}
                </button>
                {driveMount && (
                  <>
                    <button
                      type="button"
                      disabled={!!migrating || driveMount.storage_backend_id === gdrive.id}
                      onClick={() =>
                        void runMigrate(
                          'mount-drive',
                          driveMount.id,
                          { storage_backend_id: gdrive.id },
                          'Drive vault now stores on Google Drive',
                        )
                      }
                      className="rounded-md border border-arkive-border px-2 py-1.5 text-left text-xs hover:border-arkive-amber/40 disabled:opacity-50"
                    >
                      {migrating === 'mount-drive'
                        ? 'Copying…'
                        : 'Copy Drive vault → Drive storage'}
                    </button>
                    <button
                      type="button"
                      disabled={!!migrating}
                      onClick={() =>
                        void runMigrate(
                          'mount-default',
                          driveMount.id,
                          { use_default: true },
                          'Drive vault now stores on instance storage',
                        )
                      }
                      className="rounded-md border border-arkive-border px-2 py-1.5 text-left text-xs hover:border-arkive-amber/40 disabled:opacity-50"
                    >
                      {migrating === 'mount-default'
                        ? 'Copying…'
                        : 'Copy Drive vault → instance storage'}
                    </button>
                  </>
                )}
              </div>
            </details>
          )}
        </section>
      )}

      <section className="mb-8 max-w-lg rounded-2xl border border-arkive-border bg-arkive-surface/70 p-5">
        <h2 className="font-display text-lg font-semibold">Icedrive / Internxt / WebDAV</h2>
        <p className="mt-1 mb-4 text-xs text-arkive-muted">
          Connect a WebDAV endpoint (Icedrive) or Internxt WebDAV bridge as another Connected root.
          Arkive stores opaque blobs there — same vault model as Google Drive.
        </p>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-arkive-muted">Provider</span>
            <select
              value={webdavType}
              onChange={(e) => setWebdavType(e.target.value as 'webdav' | 'internxt')}
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2"
            >
              <option value="webdav">Icedrive / WebDAV</option>
              <option value="internxt">Internxt (WebDAV)</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-arkive-muted">WebDAV URL</span>
            <input
              value={webdavURL}
              onChange={(e) => setWebdavURL(e.target.value)}
              placeholder="https://webdav.icedrive.io/…"
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-arkive-muted">Username</span>
            <input
              value={webdavUser}
              onChange={(e) => setWebdavUser(e.target.value)}
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-arkive-muted">Password / app key</span>
            <input
              type="password"
              value={webdavPass}
              onChange={(e) => setWebdavPass(e.target.value)}
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2"
            />
          </label>
          <button
            type="button"
            onClick={() =>
              void api
                .connectWebDAV({
                  type: webdavType,
                  url: webdavURL,
                  username: webdavUser,
                  password: webdavPass,
                })
                .then(() => {
                  setMessage('Cloud connected — open under Files → Connected');
                  setWebdavPass('');
                  return refreshStorage();
                })
                .catch((e) => setError(String(e)))
            }
            className="rounded-lg border border-arkive-border px-3 py-2 text-sm hover:border-arkive-amber/50"
          >
            Connect
          </button>
        </div>
      </section>

      <section className="max-w-lg rounded-2xl border border-arkive-border bg-arkive-surface/70 p-5">
        <h2 className="font-display text-lg font-semibold">WebDAV mount</h2>
        <p className="mt-1 mb-4 text-xs text-arkive-muted">
          Mount a workspace as a network drive (HTTP Basic). Prefer an{' '}
          <span className="text-arkive-text">app password</span> below instead of your login
          password — username is your Arkive email.
        </p>
        <ul className="space-y-3">
          {workspaces.map((ws) => {
            const url = davURL(ws.id);
            return (
              <li key={ws.id} className="rounded-lg border border-arkive-border bg-arkive-panel/40 px-3 py-2">
                <div className="mb-1 text-sm font-medium">{workspaceLabel(ws)}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 break-all text-xs text-arkive-muted">{url}</code>
                  <button
                    type="button"
                    onClick={() => void copyDav(ws)}
                    className="shrink-0 cursor-pointer rounded-md border border-arkive-border px-2 py-1 text-xs hover:border-arkive-amber/40"
                  >
                    {copied === ws.id ? 'Copied' : 'Copy URL'}
                  </button>
                </div>
              </li>
            );
          })}
          {workspaces.length === 0 && (
            <li className="text-sm text-arkive-muted">No workspaces yet.</li>
          )}
        </ul>

        <div className="mt-6 border-t border-arkive-border pt-5">
          <h3 className="text-sm font-semibold">App passwords</h3>
          <p className="mt-1 mb-3 text-xs text-arkive-muted">
            Create a token for Finder, rclone, or other WebDAV clients. You can revoke it anytime
            without changing your login password.
          </p>

          <form onSubmit={(e) => void createAppPassword(e)} className="mb-4 flex flex-wrap gap-2">
            <input
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              placeholder="Name (e.g. MacBook)"
              maxLength={80}
              className="min-w-0 flex-1 rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-arkive-amber/40"
            />
            <button
              type="submit"
              disabled={tokenBusy}
              className="cursor-pointer rounded-lg bg-gradient-to-r from-arkive-orange to-arkive-amber px-3 py-2 text-sm font-semibold text-black disabled:opacity-50"
            >
              {tokenBusy ? 'Creating…' : 'Create'}
            </button>
          </form>

          {newSecret && (
            <div className="mb-4 rounded-lg border border-arkive-amber/40 bg-arkive-amber/10 px-3 py-3">
              <p className="mb-2 text-xs text-arkive-muted">
                Copy this secret now — it won’t be shown again.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all text-xs text-arkive-text">{newSecret}</code>
                <button
                  type="button"
                  className="shrink-0 cursor-pointer rounded-md border border-arkive-border px-2 py-1 text-xs hover:border-arkive-amber/40"
                  onClick={() => {
                    void navigator.clipboard.writeText(newSecret).then(() => {
                      setCopied('secret');
                      setTimeout(() => setCopied((c) => (c === 'secret' ? '' : c)), 2000);
                    });
                  }}
                >
                  {copied === 'secret' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          <ul className="space-y-2">
            {appPasswords.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-arkive-border bg-arkive-panel/40 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-arkive-muted">
                    ark_{p.prefix}_… · created {new Date(p.created_at).toLocaleString()}
                    {p.last_used_at
                      ? ` · last used ${new Date(p.last_used_at).toLocaleString()}`
                      : ' · never used'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void revokeAppPassword(p.id, p.name)}
                  className="cursor-pointer rounded-md px-2 py-1 text-xs text-red-300 hover:bg-arkive-panel"
                >
                  Revoke
                </button>
              </li>
            ))}
            {appPasswords.length === 0 && (
              <li className="text-sm text-arkive-muted">No app passwords yet.</li>
            )}
          </ul>
        </div>
      </section>
      {confirmDialog}
    </motion.div>
  );
}
