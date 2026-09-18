import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import {
  AdminIcon,
  CheckCircleIcon,
  SearchIcon,
  StarIcon,
  TrashIcon,
  UserCheckIcon,
  UserMinusIcon,
} from '../components/icons';
import { api, type StorageBackend, type User, type Workspace } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Notice } from '../components/ui/Notice';
import { useAuth } from '../lib/auth';
import { useConfirm } from '../lib/confirm';

export function AdminPage() {
  const { user } = useAuth();
  const [backends, setBackends] = useState<StorageBackend[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState<'s3' | 'local'>('local');
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
  const [mountPath, setMountPath] = useState('/data/arkive');
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
  const [trashRetentionDays, setTrashRetentionDays] = useState('30');
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [quotaDraft, setQuotaDraft] = useState<Record<string, string>>({});

  async function refresh() {
    const [b, w, u, g, s, q, t, reg] = await Promise.all([
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
      api.trashSettings().catch(() => ({ trash_retention_days: 30 })),
      api.registrationSettings().catch(() => ({ registration_open: true })),
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
    setTrashRetentionDays(String(t.trash_retention_days ?? 30));
    setRegistrationOpen(reg.registration_open);
    const drafts: Record<string, string> = {};
    for (const user of u) {
      drafts[user.id] = user.quota_bytes ? String(Math.round(user.quota_bytes / 1024 ** 3)) : '';
    }
    setQuotaDraft(drafts);
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
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">
          Admin
        </h1>
        <p className="mt-0.5 text-[13px] text-muted">
          Approve signups and manage storage backends for this instance.
        </p>
      </div>

      {error && <Notice kind="error" className="mb-4">{error}</Notice>}
      {message && (
        <p className="mb-4 flex items-center gap-2 text-sm text-ok">
          <CheckCircleIcon size={15} className="shrink-0" /> {message}
        </p>
      )}

      <section className="panel mb-6 p-5">
        <h2 className="mb-1 text-[15px] font-semibold">
          Google Drive OAuth
        </h2>
        <p className="mb-3 text-xs text-muted">
          Instance-wide Google Cloud web client so users can connect Drive under Account. Redirect URI must
          be allowlisted in Google Cloud Console (default ends with{' '}
          <code>/api/auth/google/drive/callback</code>).
        </p>
        <p className="mb-4 text-xs text-muted">
          Status:{' '}
          <span className="text-ink">
            {google.enabled ? 'enabled' : 'disabled'}
          </span>
          {' · '}
          source <span className="text-ink">{google.source}</span>
          {google.source === 'env' && (
            <span> — env vars override DB; clear ARKIVE_GOOGLE_* to use values saved here.</span>
          )}
        </p>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1.5 block text-xs font-medium text-muted">Client ID</span>
            <input
              value={googleClientID}
              onChange={(e) => setGoogleClientID(e.target.value)}
              disabled={google.source === 'env'}
              className="input-field font-mono text-xs"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1.5 block text-xs font-medium text-muted">Client secret</span>
            <input
              type="password"
              value={googleSecret}
              onChange={(e) => setGoogleSecret(e.target.value)}
              disabled={google.source === 'env'}
              placeholder={google.has_secret ? 'unchanged' : ''}
              className="input-field font-mono text-xs"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1.5 block text-xs font-medium text-muted">Redirect URL (optional override)</span>
            <input
              value={googleRedirect}
              onChange={(e) => setGoogleRedirect(e.target.value)}
              disabled={google.source === 'env'}
              className="input-field font-mono text-xs"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="primary"
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
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="secondary"
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
          >
            Clear DB settings
          </Button>
        </div>
      </section>

      <section className="panel mb-6 p-5">
        <h2 className="mb-1 text-[15px] font-semibold">
          SMTP (signup email)
        </h2>
        <p className="mb-3 text-xs text-muted">
          Optional. When configured, approve/reject sends a short email. Env{' '}
          <code>ARKIVE_SMTP_*</code> overrides DB. Source: {smtp.source}.
        </p>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-muted">Host</span>
            <input
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              disabled={smtp.source === 'env'}
              className="input-field text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-muted">Port</span>
            <input
              value={smtpPort}
              onChange={(e) => setSmtpPort(e.target.value)}
              disabled={smtp.source === 'env'}
              className="input-field text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-muted">Username</span>
            <input
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
              disabled={smtp.source === 'env'}
              className="input-field text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-muted">Password</span>
            <input
              type="password"
              value={smtpPass}
              onChange={(e) => setSmtpPass(e.target.value)}
              disabled={smtp.source === 'env'}
              placeholder={smtp.has_password ? 'unchanged' : ''}
              className="input-field text-sm"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1.5 block text-xs font-medium text-muted">From address</span>
            <input
              value={smtpFrom}
              onChange={(e) => setSmtpFrom(e.target.value)}
              disabled={smtp.source === 'env'}
              className="input-field text-sm"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="primary"
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
          >
            Save SMTP
          </Button>
          <Button
            size="sm"
            variant="secondary"
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
          >
            Clear
          </Button>
        </div>
      </section>

      <section className="panel mb-6 p-5">
        <h2 className="mb-1 text-[15px] font-semibold">
          Quotas &amp; search
        </h2>
        <p className="mb-3 text-xs text-muted">
          Default workspace quota (GB). Empty = unlimited. Personal workspaces also inherit the
          owner’s user quota when set. Auto-purge permanently deletes trash older than N days (0 =
          disable).
        </p>
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-muted">Default quota (GB)</span>
            <input
              value={defaultQuotaGB}
              onChange={(e) => setDefaultQuotaGB(e.target.value)}
              placeholder="unlimited"
              className="input-field w-40 text-sm"
            />
          </label>
          <Button
            size="sm"
            variant="primary"
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
          >
            Save default
          </Button>
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-muted">Auto-purge trash after N days</span>
            <input
              type="number"
              min={0}
              value={trashRetentionDays}
              onChange={(e) => setTrashRetentionDays(e.target.value)}
              className="input-field w-40 text-sm"
            />
          </label>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const days = Number(trashRetentionDays);
              if (!Number.isFinite(days) || days < 0 || !Number.isInteger(days)) {
                setError('Trash retention must be a whole number ≥ 0');
                return;
              }
              void api
                .putTrashSettings(days)
                .then(() => setMessage(`Trash retention saved (${days === 0 ? 'disabled' : `${days} days`})`))
                .catch((e) => setError(String(e)));
            }}
          >
            Save retention
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              void api
                .reindexSearch()
                .then((r) =>
                  setMessage(
                    `Reindexed ${r.indexed} file(s)` +
                      (r.remaining > 0 ? ` — ${r.remaining} remaining, run again` : ''),
                  ),
                )
                .catch((e) => setError(String(e)))
            }
          >
            Reindex search
          </Button>
        </div>
        <ul className="space-y-2 text-sm">
          {others.map((u) => (
            <li
              key={u.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-inset px-3.5 py-2.5 transition hover:border-strong"
            >
              <span className="truncate">
                {u.display_name}{' '}
                <span className="text-muted">({u.email})</span>
              </span>
              <span className="flex items-center gap-2 text-xs">
                <input
                  type="number"
                  min={0}
                  placeholder="GB"
                  value={quotaDraft[u.id] ?? ''}
                  onChange={(e) => setQuotaDraft((d) => ({ ...d, [u.id]: e.target.value }))}
                  className="input-field w-20 !px-2 !py-1 text-xs"
                />
                <button
                  type="button"
                  className="cursor-pointer rounded px-2 py-1 font-medium text-accent-strong transition hover:bg-hover"
                  onClick={() => {
                    const raw = (quotaDraft[u.id] ?? '').trim();
                    const gb = Number(raw);
                    const bytes =
                      raw === '' || !Number.isFinite(gb) || gb <= 0 ? null : Math.round(gb * 1024 ** 3);
                    void api
                      .setUserQuota(u.id, bytes)
                      .then(() => refresh())
                      .then(() => setMessage('User quota updated'))
                      .catch((e) => setError(String(e)));
                  }}
                >
                  Save quota
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel mb-6 p-5">
        <h2 className="mb-1 text-[15px] font-semibold">
          Users
        </h2>
        <p className="mb-4 text-xs text-muted">
          New registrations stay pending until approved. Rejected and disabled accounts cannot sign in.
        </p>
        <label className="mb-4 flex cursor-pointer items-center gap-2.5 rounded-md border border-line bg-inset px-3.5 py-2.5 text-sm transition hover:border-strong">
          <input
            type="checkbox"
            checked={registrationOpen}
            onChange={(e) => {
              const open = e.target.checked;
              setRegistrationOpen(open);
              void api
                .putRegistrationSettings(open)
                .then(() => setMessage(open ? 'Registration open' : 'Registration closed'))
                .catch((err) => setError(String(err)));
            }}
          />
          Allow public registration
        </label>
        {pending.length === 0 ? (
          <p className="mb-4 text-sm text-muted">No pending signups.</p>
        ) : (
          <ul className="mb-4 space-y-2">
            {pending.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent/40 bg-accent-soft px-4 py-3 text-sm"
              >
                <div>
                  <div className="font-medium">{u.display_name}</div>
                  <div className="text-xs text-muted">
                    {u.email} · requested {new Date(u.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-2 text-xs">
                  <Button
                    size="xs"
                    variant="primary"
                    onClick={() =>
                      void api
                        .approveUser(u.id)
                        .then(refresh)
                        .then(() => setMessage(`Approved ${u.email}`))
                        .catch((e) => setError(String(e)))
                    }
                    icon={<UserCheckIcon size={12} />}
                  >
                    Approve
                  </Button>
                  <Button
                    size="xs"
                    variant="secondary"
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
                    icon={<UserMinusIcon size={12} />}
                  >
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {others.length > 0 && (
          <ul className="space-y-1 text-sm text-muted">
            {others.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center gap-2 rounded-md px-2.5 py-2 transition hover:bg-hover"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-hover text-[11px] font-semibold text-muted">
                  {(u.display_name || u.email || '?').trim().charAt(0).toUpperCase()}
                </span>
                <span className="text-ink">{u.display_name}</span>
                <span>{u.email}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 capitalize ${
                    u.status === 'active'
                      ? 'bg-ok-soft text-ok ring-ok/40'
                      : u.status === 'rejected'
                        ? 'bg-danger-soft text-danger ring-danger/40'
                        : 'bg-accent-soft text-accent-strong ring-accent/40'
                  }`}
                >
                  {u.status}
                </span>
                {u.is_instance_admin && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent-strong ring-1 ring-accent/40">
                    <AdminIcon size={10} /> admin
                  </span>
                )}
                {u.id !== user?.id && (
                  <span className="ml-auto flex flex-wrap gap-2 text-xs">
                    {u.status === 'active' && (
                      <button
                        type="button"
                        className="cursor-pointer rounded px-1.5 py-0.5 transition hover:bg-hover hover:text-accent-strong"
                        onClick={() =>
                          void api
                            .disableUser(u.id)
                            .then(refresh)
                            .then(() => setMessage(`Disabled ${u.email}`))
                            .catch((e) => setError(String(e)))
                        }
                      >
                        Disable
                      </button>
                    )}
                    {u.status === 'disabled' && (
                      <button
                        type="button"
                        className="cursor-pointer rounded px-1.5 py-0.5 transition hover:bg-hover hover:text-accent-strong"
                        onClick={() =>
                          void api
                            .approveUser(u.id)
                            .then(refresh)
                            .then(() => setMessage(`Re-enabled ${u.email}`))
                            .catch((e) => setError(String(e)))
                        }
                      >
                        Enable
                      </button>
                    )}
                    <button
                      type="button"
                      className="cursor-pointer rounded px-1.5 py-0.5 transition hover:bg-hover hover:text-accent-strong"
                      onClick={() =>
                        void api
                          .setInstanceAdmin(u.id, !u.is_instance_admin)
                          .then(refresh)
                          .then(() => setMessage(u.is_instance_admin ? 'Demoted' : 'Promoted'))
                          .catch((e) => setError(String(e)))
                      }
                    >
                      {u.is_instance_admin ? 'Demote' : 'Promote'}
                    </button>
                    <button
                      type="button"
                      className="cursor-pointer rounded px-1.5 py-0.5 transition hover:bg-danger-soft hover:text-danger"
                      onClick={() =>
                        ask({
                          title: 'Delete user',
                          message: `Permanently delete ${u.email} and their personal vault? Team owners cannot be deleted.`,
                          confirmLabel: 'Delete',
                          run: async () => {
                            await api.deleteUser(u.id);
                            await refresh();
                            setMessage(`Deleted ${u.email}`);
                          },
                        })
                      }
                    >
                      Delete
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <h2 className="mb-3 text-[17px] font-semibold">
        Storage
      </h2>

      <form
        onSubmit={onCreate}
        className="panel mb-6 p-5"
      >
        <h2 className="mb-3 text-[15px] font-semibold">
          Add backend
        </h2>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-muted">Name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-field"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-muted">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 's3' | 'local')}
              className="input-field cursor-pointer"
            >
              <option value="local">Local folder</option>
              <option value="s3">S3-compatible</option>
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
                <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
                <input
                  required={key !== 'region'}
                  type={key.includes('secret') ? 'password' : 'text'}
                  value={String(s3[key])}
                  onChange={(e) => setS3({ ...s3, [key]: e.target.value })}
                  className="input-field"
                />
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={s3.use_ssl}
                onChange={(e) => setS3({ ...s3, use_ssl: e.target.checked })}
              />
              Use SSL
            </label>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={s3.force_path_style}
                onChange={(e) => setS3({ ...s3, force_path_style: e.target.checked })}
              />
              Path-style addressing
            </label>
          </div>
        ) : (
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-muted">Path inside the API container</span>
            <input
              required
              value={mountPath}
              onChange={(e) => setMountPath(e.target.value)}
              className="input-field font-mono text-sm"
            />
            <span className="mt-1 block text-xs text-muted">
              Directory visible inside the API container. Bind-mount a host path or an NFS mount, then enter that path. Compose defaults to <code>/data/arkive</code>.
            </span>
          </label>
        )}

        <Button
          type="submit"
          size="sm"
          variant="primary"
          className="mt-4"
        >
          Test &amp; save
        </Button>
      </form>

      <ul className="mb-6 space-y-3">
        {backends.map((b) => (
          <li
            key={b.id}
            className="panel px-4 py-3 transition hover:border-strong"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">
                  {b.name}{' '}
                  {b.is_default && (
                    <span className="ml-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent-strong ring-1 ring-accent/40">
                      default
                    </span>
                  )}
                </div>
                <div className="font-mono text-xs text-muted">
                  {b.type} · {JSON.stringify(b.config)}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() =>
                    void api
                      .testBackend(b.id)
                      .then(() => setMessage(`Test OK: ${b.name}`))
                      .catch((e) => setError(String(e)))
                  }
                  icon={<SearchIcon size={12} />}
                >
                  Test
                </Button>
                {!b.is_default && (
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() =>
                      void api
                        .setDefaultBackend(b.id)
                        .then(refresh)
                        .catch((e) => setError(String(e)))
                    }
                    icon={<StarIcon size={12} />}
                  >
                    Make default
                  </Button>
                )}
                {!b.is_default && (
                  <Button
                    size="xs"
                    variant="secondary"
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
                    icon={<TrashIcon size={12} />}
                    className="hover:!border-danger/60 hover:!text-danger"
                  >
                    Delete
                  </Button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <section className="panel p-5">
        <h2 className="mb-3 text-[15px] font-semibold">
          Assign workspace backend
        </h2>
        <p className="mb-3 text-xs text-muted">
          By default only the storage pointer changes. Enable copy below to migrate current files, trash,
          and versions to the new store first. Large vaults may take a while.
        </p>
        <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={copyOnAssign}
            onChange={(e) => setCopyOnAssign(e.target.checked)}
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
                className="input-field !w-auto cursor-pointer !py-1.5 text-sm"
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
