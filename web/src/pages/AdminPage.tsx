import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api, type StorageBackend, type User, type Workspace } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useConfirm } from '../lib/confirm';

export function AdminPage() {
  const { user } = useAuth();
  const [backends, setBackends] = useState<StorageBackend[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState<'s3' | 'nfs'>('s3');
  const [name, setName] = useState('');
  const [s3, setS3] = useState({
    endpoint: '',
    access_key: '',
    secret_key: '',
    bucket: '',
    region: 'us-east-1',
    use_ssl: false,
    force_path_style: true,
  });
  const [mountPath, setMountPath] = useState('/mnt/arkive-nfs');
  const [google, setGoogle] = useState({
    enabled: false,
    client_id: '',
    has_secret: false,
    redirect_url: '',
    source: 'none' as 'env' | 'db' | 'none',
  });
  const [googleClientID, setGoogleClientID] = useState('');
  const [googleSecret, setGoogleSecret] = useState('');
  const [googleRedirect, setGoogleRedirect] = useState('');
  const [migratingWs, setMigratingWs] = useState('');
  const [copyOnAssign, setCopyOnAssign] = useState(false);
  const { ask, dialog: confirmDialog } = useConfirm();
  const [smtp, setSmtp] = useState({
    enabled: false,
    host: '',
    port: '',
    user: '',
    from: '',
    has_password: false,
    source: 'none',
  });
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [defaultQuotaGB, setDefaultQuotaGB] = useState('');

  async function refresh() {
    const [b, w, u, g, s, q] = await Promise.all([
      api.backends(),
      api.workspaces(),
      api.adminUsers(),
      api.googleSettings(),
      api.smtpSettings().catch(() => ({
        enabled: false,
        host: '',
        port: '587',
        user: '',
        from: '',
        has_password: false,
        source: 'none',
      })),
      api.quotaSettings().catch(() => ({ default_workspace_quota_bytes: null })),
    ]);
    setBackends(b);
    setWorkspaces(w);
    setUsers(u);
    setGoogle(g);
    setGoogleClientID(g.client_id || '');
    setGoogleRedirect(g.redirect_url || '');
    setGoogleSecret('');
    setSmtp(s);
    setSmtpHost(s.host || '');
    setSmtpPort(s.port || '587');
    setSmtpUser(s.user || '');
    setSmtpFrom(s.from || '');
    setDefaultQuotaGB(
      q.default_workspace_quota_bytes
        ? String(Math.round(q.default_workspace_quota_bytes / (1024 ** 3)))
        : '',
    );
  }

  useEffect(() => {
    if (!user?.is_instance_admin) return;
    void refresh().catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, [user]);

  if (!user?.is_instance_admin) return <Navigate to="/" replace />;

  const pending = users.filter((u) => u.status === 'pending');
  const others = users.filter((u) => u.status !== 'pending');

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const config =
        type === 's3'
          ? { ...s3 }
          : { mount_path: mountPath };
      await api.createBackend({ name, type, config, is_default: false });
      setName('');
      setMessage('Backend added');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-arkive-muted">
          Approve signups and manage storage backends for this instance.
        </p>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {message && <p className="mb-4 text-sm text-arkive-glow">{message}</p>}

      <section className="mb-8 rounded-2xl border border-arkive-border bg-arkive-surface/70 p-5">
        <h2 className="mb-1 font-display text-lg font-semibold">Google Drive OAuth</h2>
        <p className="mb-3 text-xs text-arkive-muted">
          Instance-wide Google Cloud web client so users can connect Drive under Account. Redirect URI must
          be allowlisted in Google Cloud Console (default ends with{' '}
          <code>/api/auth/google/drive/callback</code>).
        </p>
        <p className="mb-4 text-xs text-arkive-muted">
          Status:{' '}
          <span className="text-arkive-text">
            {google.enabled ? 'enabled' : 'disabled'}
          </span>
          {' · '}
          source <span className="text-arkive-text">{google.source}</span>
          {google.source === 'env' && (
            <span> — env vars override DB; clear ARKIVE_GOOGLE_* to use values saved here.</span>
          )}
        </p>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-arkive-muted">Client ID</span>
            <input
              value={googleClientID}
              onChange={(e) => setGoogleClientID(e.target.value)}
              disabled={google.source === 'env'}
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2 font-mono text-xs disabled:opacity-60"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-arkive-muted">Client secret</span>
            <input
              type="password"
              value={googleSecret}
              onChange={(e) => setGoogleSecret(e.target.value)}
              disabled={google.source === 'env'}
              placeholder={google.has_secret ? 'unchanged' : ''}
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2 font-mono text-xs disabled:opacity-60"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-arkive-muted">Redirect URL (optional override)</span>
            <input
              value={googleRedirect}
              onChange={(e) => setGoogleRedirect(e.target.value)}
              disabled={google.source === 'env'}
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2 font-mono text-xs disabled:opacity-60"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={google.source === 'env'}
            onClick={() =>
              void api
                .saveGoogleSettings({
                  client_id: googleClientID,
                  client_secret: googleSecret || undefined,
                  redirect_url: googleRedirect,
                })
                .then((g) => {
                  setGoogle(g);
                  setGoogleSecret('');
                  setMessage('Google OAuth settings saved');
                })
                .catch((e) => setError(String(e)))
            }
            className="rounded-lg bg-gradient-to-r from-arkive-orange to-arkive-amber px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            disabled={google.source === 'env'}
            onClick={() =>
              void api
                .saveGoogleSettings({ clear: true })
                .then((g) => {
                  setGoogle(g);
                  setGoogleClientID(g.client_id || '');
                  setGoogleRedirect(g.redirect_url || '');
                  setGoogleSecret('');
                  setMessage('Google OAuth DB settings cleared');
                })
                .catch((e) => setError(String(e)))
            }
            className="rounded-md border border-arkive-border px-3 py-1.5 text-sm hover:text-red-300 disabled:opacity-50"
          >
            Clear DB settings
          </button>
        </div>
      </section>

      <section className="mb-8 rounded-2xl border border-arkive-border bg-arkive-surface/70 p-5">
        <h2 className="mb-1 font-display text-lg font-semibold">SMTP (signup email)</h2>
        <p className="mb-3 text-xs text-arkive-muted">
          Optional. When configured, approve/reject sends a short email. Env{' '}
          <code>ARKIVE_SMTP_*</code> overrides DB. Source: {smtp.source}.
        </p>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-arkive-muted">Host</span>
            <input
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              disabled={smtp.source === 'env'}
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2 text-sm disabled:opacity-60"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-arkive-muted">Port</span>
            <input
              value={smtpPort}
              onChange={(e) => setSmtpPort(e.target.value)}
              disabled={smtp.source === 'env'}
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2 text-sm disabled:opacity-60"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-arkive-muted">Username</span>
            <input
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
              disabled={smtp.source === 'env'}
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2 text-sm disabled:opacity-60"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-arkive-muted">Password</span>
            <input
              type="password"
              value={smtpPass}
              onChange={(e) => setSmtpPass(e.target.value)}
              disabled={smtp.source === 'env'}
              placeholder={smtp.has_password ? 'unchanged' : ''}
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2 text-sm disabled:opacity-60"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-arkive-muted">From address</span>
            <input
              value={smtpFrom}
              onChange={(e) => setSmtpFrom(e.target.value)}
              disabled={smtp.source === 'env'}
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2 text-sm disabled:opacity-60"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={smtp.source === 'env'}
            onClick={() =>
              void api
                .saveSMTPSettings({
                  host: smtpHost,
                  port: smtpPort,
                  user: smtpUser,
                  password: smtpPass || undefined,
                  from: smtpFrom,
                })
                .then((s) => {
                  setSmtp(s);
                  setSmtpPass('');
                  setMessage('SMTP settings saved');
                })
                .catch((e) => setError(String(e)))
            }
            className="rounded-lg bg-gradient-to-r from-arkive-orange to-arkive-amber px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
          >
            Save SMTP
          </button>
          <button
            type="button"
            disabled={smtp.source === 'env'}
            onClick={() =>
              void api
                .saveSMTPSettings({ clear: true })
                .then((s) => {
                  setSmtp(s);
                  setSmtpHost('');
                  setSmtpFrom('');
                  setSmtpPass('');
                  setMessage('SMTP cleared');
                })
                .catch((e) => setError(String(e)))
            }
            className="rounded-md border border-arkive-border px-3 py-1.5 text-sm hover:text-red-300 disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </section>

      <section className="mb-8 rounded-2xl border border-arkive-border bg-arkive-surface/70 p-5">
        <h2 className="mb-1 font-display text-lg font-semibold">Quotas &amp; search</h2>
        <p className="mb-3 text-xs text-arkive-muted">
          Default workspace quota (GB). Empty = unlimited. Personal workspaces also inherit the
          owner’s user quota when set.
        </p>
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <label className="block text-sm">
            <span className="mb-1 block text-arkive-muted">Default quota (GB)</span>
            <input
              value={defaultQuotaGB}
              onChange={(e) => setDefaultQuotaGB(e.target.value)}
              placeholder="unlimited"
              className="w-40 rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              const gb = Number(defaultQuotaGB);
              const bytes =
                defaultQuotaGB.trim() === '' || !Number.isFinite(gb) || gb <= 0
                  ? null
                  : Math.round(gb * 1024 ** 3);
              void api
                .putQuotaSettings(bytes)
                .then(() => setMessage('Default quota saved'))
                .catch((e) => setError(String(e)));
            }}
            className="rounded-lg bg-gradient-to-r from-arkive-orange to-arkive-amber px-3 py-2 text-sm font-semibold text-black"
          >
            Save default
          </button>
          <button
            type="button"
            onClick={() =>
              void api
                .reindexSearch()
                .then((r) => setMessage(`Reindexed ${r.indexed} file(s)`))
                .catch((e) => setError(String(e)))
            }
            className="rounded-md border border-arkive-border px-3 py-2 text-sm hover:border-arkive-amber/40"
          >
            Reindex search
          </button>
        </div>
        <ul className="space-y-2 text-sm">
          {others.slice(0, 12).map((u) => (
            <li
              key={u.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-arkive-border/60 px-3 py-2"
            >
              <span className="truncate">
                {u.display_name}{' '}
                <span className="text-arkive-muted">({u.email})</span>
              </span>
              <button
                type="button"
                className="text-xs text-arkive-amber hover:underline"
                onClick={() => {
                  const raw = window.prompt(
                    'User quota in GB (empty = unlimited)',
                    u.quota_bytes ? String(Math.round(u.quota_bytes / 1024 ** 3)) : '',
                  );
                  if (raw === null) return;
                  const gb = Number(raw);
                  const bytes =
                    raw.trim() === '' || !Number.isFinite(gb) || gb <= 0
                      ? null
                      : Math.round(gb * 1024 ** 3);
                  void api
                    .setUserQuota(u.id, bytes)
                    .then(() => refresh())
                    .then(() => setMessage('User quota updated'))
                    .catch((e) => setError(String(e)));
                }}
              >
                Quota{u.quota_bytes ? `: ${Math.round(u.quota_bytes / 1024 ** 3)} GB` : ''}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-8 rounded-2xl border border-arkive-border bg-arkive-surface/70 p-5">
        <h2 className="mb-1 font-display text-lg font-semibold">Users</h2>
        <p className="mb-4 text-xs text-arkive-muted">
          New registrations stay pending until approved. Rejected accounts cannot sign in.
        </p>
        {pending.length === 0 ? (
          <p className="mb-4 text-sm text-arkive-muted">No pending signups.</p>
        ) : (
          <ul className="mb-4 space-y-2">
            {pending.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-arkive-amber/30 bg-arkive-panel/40 px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-medium">{u.display_name}</div>
                  <div className="text-xs text-arkive-muted">
                    {u.email} · requested {new Date(u.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      void api
                        .approveUser(u.id)
                        .then(refresh)
                        .then(() => setMessage(`Approved ${u.email}`))
                        .catch((e) => setError(String(e)))
                    }
                    className="rounded-md bg-gradient-to-r from-arkive-orange to-arkive-amber px-2 py-1 font-semibold text-black"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      ask({
                        title: 'Reject signup',
                        message: `Reject ${u.email}? They will not be able to sign in until approved later.`,
                        confirmLabel: 'Reject',
                        run: async () => {
                          try {
                            await api.rejectUser(u.id);
                            await refresh();
                            setMessage(`Rejected ${u.email}`);
                          } catch (e) {
                            setError(String(e));
                            throw e;
                          }
                        },
                      })
                    }
                    className="rounded-md border border-arkive-border px-2 py-1 hover:text-red-300"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {others.length > 0 && (
          <ul className="space-y-1 text-sm text-arkive-muted">
            {others.map((u) => (
              <li key={u.id} className="flex flex-wrap gap-2">
                <span className="text-arkive-text">{u.display_name}</span>
                <span>{u.email}</span>
                <span className="capitalize">{u.status}</span>
                {u.is_instance_admin && <span className="text-arkive-amber">admin</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <h2 className="mb-3 font-display text-xl font-semibold">Storage</h2>

      <motion.form
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={onCreate}
        className="mb-8 rounded-2xl border border-arkive-border bg-arkive-surface/70 p-5"
      >
        <h2 className="mb-3 font-display text-lg font-semibold">Add backend</h2>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-arkive-muted">Name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-arkive-muted">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 's3' | 'nfs')}
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2"
            >
              <option value="s3">S3-compatible</option>
              <option value="nfs">NFS / local mount</option>
            </select>
          </label>
        </div>

        {type === 's3' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['endpoint', 'Endpoint (host:port)'],
                ['bucket', 'Bucket'],
                ['region', 'Region'],
                ['access_key', 'Access key'],
                ['secret_key', 'Secret key'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block text-sm">
                <span className="mb-1 block text-arkive-muted">{label}</span>
                <input
                  required={key !== 'region'}
                  type={key.includes('secret') ? 'password' : 'text'}
                  value={String(s3[key])}
                  onChange={(e) => setS3({ ...s3, [key]: e.target.value })}
                  className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2"
                />
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm text-arkive-muted">
              <input
                type="checkbox"
                checked={s3.use_ssl}
                onChange={(e) => setS3({ ...s3, use_ssl: e.target.checked })}
              />
              Use SSL
            </label>
            <label className="flex items-center gap-2 text-sm text-arkive-muted">
              <input
                type="checkbox"
                checked={s3.force_path_style}
                onChange={(e) => setS3({ ...s3, force_path_style: e.target.checked })}
              />
              Path-style (MinIO)
            </label>
          </div>
        ) : (
          <label className="block text-sm">
            <span className="mb-1 block text-arkive-muted">Mount path inside API container</span>
            <input
              required
              value={mountPath}
              onChange={(e) => setMountPath(e.target.value)}
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2 font-mono text-sm"
            />
            <span className="mt-1 block text-xs text-arkive-muted">
              Compose ships a demo volume at <code>/mnt/arkive-nfs</code>. For a real NFS share, mount it into the API service.
            </span>
          </label>
        )}

        <button
          type="submit"
          className="mt-4 rounded-lg bg-gradient-to-r from-arkive-orange to-arkive-amber px-4 py-2 text-sm font-semibold text-black"
        >
          Test &amp; save
        </button>
      </motion.form>

      <ul className="mb-8 space-y-3">
        {backends.map((b) => (
          <li
            key={b.id}
            className="rounded-2xl border border-arkive-border bg-arkive-surface/70 px-4 py-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">
                  {b.name}{' '}
                  {b.is_default && (
                    <span className="text-xs text-arkive-amber">(default)</span>
                  )}
                </div>
                <div className="text-xs text-arkive-muted">
                  {b.type} · {JSON.stringify(b.config)}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  onClick={() =>
                    void api
                      .testBackend(b.id)
                      .then(() => setMessage(`Test OK: ${b.name}`))
                      .catch((e) => setError(String(e)))
                  }
                  className="rounded-md border border-arkive-border px-2 py-1 hover:border-arkive-amber/40"
                >
                  Test
                </button>
                {!b.is_default && (
                  <button
                    type="button"
                    onClick={() =>
                      void api
                        .setDefaultBackend(b.id)
                        .then(refresh)
                        .catch((e) => setError(String(e)))
                    }
                    className="rounded-md border border-arkive-border px-2 py-1 hover:border-arkive-amber/40"
                  >
                    Make default
                  </button>
                )}
                {!b.is_default && (
                  <button
                    type="button"
                    onClick={() =>
                      ask({
                        title: 'Delete storage backend',
                        message: `Delete “${b.name}”? Workspaces must not be using it (or the API will refuse).`,
                        confirmLabel: 'Delete',
                        run: async () => {
                          try {
                            await api.deleteBackend(b.id);
                            await refresh();
                          } catch (e) {
                            setError(String(e));
                            throw e;
                          }
                        },
                      })
                    }
                    className="rounded-md border border-arkive-border px-2 py-1 hover:text-red-300"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <section className="rounded-2xl border border-arkive-border bg-arkive-surface/70 p-5">
        <h2 className="mb-3 font-display text-lg font-semibold">Assign workspace backend</h2>
        <p className="mb-3 text-xs text-arkive-muted">
          By default only the storage pointer changes. Enable copy below to migrate current files, trash,
          and versions to the new store first. Large vaults may take a while.
        </p>
        <label className="mb-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={copyOnAssign}
            onChange={(e) => setCopyOnAssign(e.target.checked)}
            className="h-4 w-4 accent-arkive-amber"
          />
          Also copy existing files
        </label>
        <ul className="space-y-3">
          {workspaces.map((ws) => (
            <li key={ws.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-40 font-medium">
                {ws.type === 'personal' ? 'My files' : ws.type === 'mount' ? `${ws.name} (mount)` : ws.name}
              </span>
              <select
                value={ws.storage_backend_id || backends.find((b) => b.is_default)?.id || ''}
                disabled={migratingWs === ws.id}
                onChange={(e) => {
                  setMigratingWs(ws.id);
                  setError('');
                  setMessage(copyOnAssign ? `Migrating ${ws.name}…` : `Updating ${ws.name}…`);
                  void api
                    .assignWorkspaceBackend(ws.id, e.target.value, copyOnAssign)
                    .then((res) => {
                      setMessage(
                        res.migrated
                          ? `Migrated ${res.copied}/${res.total} objects for ${ws.name}`
                          : `Assigned backend for ${ws.name}`,
                      );
                      return refresh();
                    })
                    .catch((err) => setError(String(err)))
                    .finally(() => setMigratingWs(''));
                }}
                className="rounded-lg border border-arkive-border bg-arkive-bg px-2 py-1.5 disabled:opacity-60"
              >
                {backends.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </section>
      {confirmDialog}
    </div>
  );
}
