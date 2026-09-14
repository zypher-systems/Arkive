import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Database,
  Gauge,
  HardDrive,
  Mail,
  Plus,
  SearchCheck,
  ShieldCheck,
  Star,
  Trash2,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';
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
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          <span className="text-iridescent">Admin</span>
        </h1>
        <p className="mt-1 text-sm text-arkive-muted">
          Approve signups and manage storage backends for this instance.
        </p>
      </div>

      {error && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
          <AlertCircle size={15} className="shrink-0" />
          {error}
        </p>
      )}
      {message && (
        <p className="mb-4 flex items-center gap-2 text-sm text-emerald-300">
          <CheckCircle2 size={15} className="shrink-0" /> {message}
        </p>
      )}

      <section className="glass glass-hairline mb-8 rounded-3xl p-5">
        <h2 className="mb-1 flex items-center gap-2.5 font-display text-lg font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-arkive-accent/25 to-arkive-accent2/20 text-arkive-accent2 ring-1 ring-white/10">
            <Cloud size={15} />
          </span>
          Google Drive OAuth
        </h2>
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
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-arkive-muted uppercase">Client ID</span>
            <input
              value={googleClientID}
              onChange={(e) => setGoogleClientID(e.target.value)}
              disabled={google.source === 'env'}
              className="input-glass font-mono text-xs disabled:opacity-60"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-arkive-muted uppercase">Client secret</span>
            <input
              type="password"
              value={googleSecret}
              onChange={(e) => setGoogleSecret(e.target.value)}
              disabled={google.source === 'env'}
              placeholder={google.has_secret ? 'unchanged' : ''}
              className="input-glass font-mono text-xs disabled:opacity-60"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-arkive-muted uppercase">Redirect URL (optional override)</span>
            <input
              value={googleRedirect}
              onChange={(e) => setGoogleRedirect(e.target.value)}
              disabled={google.source === 'env'}
              className="input-glass font-mono text-xs disabled:opacity-60"
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
            className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-iridescent px-3 py-1.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(139,92,246,0.35)] transition hover:brightness-110 disabled:opacity-50"
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
            className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/8 px-2.5 py-1 text-xs text-arkive-muted transition hover:border-red-400/50 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50 !px-3 !py-1.5 !text-sm"
          >
            Clear DB settings
          </button>
        </div>
      </section>

      <section className="glass glass-hairline mb-8 rounded-3xl p-5">
        <h2 className="mb-1 flex items-center gap-2.5 font-display text-lg font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-arkive-accent/25 to-arkive-accent2/20 text-arkive-accent2 ring-1 ring-white/10">
            <Mail size={15} />
          </span>
          SMTP (signup email)
        </h2>
        <p className="mb-3 text-xs text-arkive-muted">
          Optional. When configured, approve/reject sends a short email. Env{' '}
          <code>ARKIVE_SMTP_*</code> overrides DB. Source: {smtp.source}.
        </p>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-arkive-muted uppercase">Host</span>
            <input
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              disabled={smtp.source === 'env'}
              className="input-glass text-sm disabled:opacity-60"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-arkive-muted uppercase">Port</span>
            <input
              value={smtpPort}
              onChange={(e) => setSmtpPort(e.target.value)}
              disabled={smtp.source === 'env'}
              className="input-glass text-sm disabled:opacity-60"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-arkive-muted uppercase">Username</span>
            <input
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
              disabled={smtp.source === 'env'}
              className="input-glass text-sm disabled:opacity-60"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-arkive-muted uppercase">Password</span>
            <input
              type="password"
              value={smtpPass}
              onChange={(e) => setSmtpPass(e.target.value)}
              disabled={smtp.source === 'env'}
              placeholder={smtp.has_password ? 'unchanged' : ''}
              className="input-glass text-sm disabled:opacity-60"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-arkive-muted uppercase">From address</span>
            <input
              value={smtpFrom}
              onChange={(e) => setSmtpFrom(e.target.value)}
              disabled={smtp.source === 'env'}
              className="input-glass text-sm disabled:opacity-60"
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
            className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-iridescent px-3 py-1.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(139,92,246,0.35)] transition hover:brightness-110 disabled:opacity-50"
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
            className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/8 px-2.5 py-1 text-xs text-arkive-muted transition hover:border-red-400/50 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50 !px-3 !py-1.5 !text-sm"
          >
            Clear
          </button>
        </div>
      </section>

      <section className="glass glass-hairline mb-8 rounded-3xl p-5">
        <h2 className="mb-1 flex items-center gap-2.5 font-display text-lg font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-arkive-accent/25 to-arkive-accent2/20 text-arkive-accent2 ring-1 ring-white/10">
            <Gauge size={15} />
          </span>
          Quotas &amp; search
        </h2>
        <p className="mb-3 text-xs text-arkive-muted">
          Default workspace quota (GB). Empty = unlimited. Personal workspaces also inherit the
          owner’s user quota when set. Auto-purge permanently deletes trash older than N days (0 =
          disable).
        </p>
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-arkive-muted uppercase">Default quota (GB)</span>
            <input
              value={defaultQuotaGB}
              onChange={(e) => setDefaultQuotaGB(e.target.value)}
              placeholder="unlimited"
              className="input-glass w-40 text-sm"
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
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-iridescent px-3.5 py-2 text-sm font-semibold text-white shadow-[0_4px_20px_rgba(139,92,246,0.35)] transition hover:brightness-110 hover:shadow-[0_6px_28px_rgba(139,92,246,0.5)] disabled:opacity-50"
          >
            Save default
          </button>
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-arkive-muted uppercase">Auto-purge trash after N days</span>
            <input
              type="number"
              min={0}
              value={trashRetentionDays}
              onChange={(e) => setTrashRetentionDays(e.target.value)}
              className="input-glass w-40 text-sm"
            />
          </label>
          <button
            type="button"
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
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/8 bg-white/[0.04] px-3.5 py-2 text-sm text-arkive-text backdrop-blur-md transition hover:border-white/16 hover:bg-white/[0.08] disabled:opacity-50"
          >
            Save retention
          </button>
          <button
            type="button"
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
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/8 bg-white/[0.04] px-3.5 py-2 text-sm text-arkive-text backdrop-blur-md transition hover:border-white/16 hover:bg-white/[0.08] disabled:opacity-50"
          >
            Reindex search
          </button>
        </div>
        <ul className="space-y-2 text-sm">
          {others.map((u) => (
            <li
              key={u.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/7 bg-white/[0.03] px-3.5 py-2.5 transition hover:border-white/12"
            >
              <span className="truncate">
                {u.display_name}{' '}
                <span className="text-arkive-muted">({u.email})</span>
              </span>
              <span className="flex items-center gap-2 text-xs">
                <input
                  type="number"
                  min={0}
                  placeholder="GB"
                  value={quotaDraft[u.id] ?? ''}
                  onChange={(e) => setQuotaDraft((d) => ({ ...d, [u.id]: e.target.value }))}
                  className="input-glass w-20 !rounded-lg !px-2 !py-1 text-xs"
                />
                <button
                  type="button"
                  className="cursor-pointer rounded-lg px-2 py-1 font-medium text-arkive-accent2 transition hover:bg-white/[0.07]"
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

      <section className="glass glass-hairline mb-8 rounded-3xl p-5">
        <h2 className="mb-1 flex items-center gap-2.5 font-display text-lg font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-arkive-accent/25 to-arkive-accent2/20 text-arkive-accent2 ring-1 ring-white/10">
            <Users size={15} />
          </span>
          Users
        </h2>
        <p className="mb-4 text-xs text-arkive-muted">
          New registrations stay pending until approved. Rejected and disabled accounts cannot sign in.
        </p>
        <label className="mb-4 flex cursor-pointer items-center gap-2.5 rounded-xl border border-white/7 bg-white/[0.03] px-3.5 py-2.5 text-sm transition hover:border-white/12">
          <input
            type="checkbox"
            className="h-4 w-4 accent-arkive-accent"
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
          <p className="mb-4 text-sm text-arkive-muted">No pending signups.</p>
        ) : (
          <ul className="mb-4 space-y-2">
            {pending.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-arkive-accent/35 bg-gradient-to-r from-arkive-accent/12 to-arkive-accent2/6 px-4 py-3 text-sm shadow-[0_0_24px_rgba(139,92,246,0.1)]"
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
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-iridescent px-3 py-1.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(139,92,246,0.35)] transition hover:brightness-110 disabled:opacity-50 !px-2.5 !py-1 !text-xs"
                  >
                    <UserCheck size={12} /> Approve
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
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/8 px-2.5 py-1 text-xs text-arkive-muted transition hover:border-red-400/50 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                  >
                    <UserX size={12} /> Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {others.length > 0 && (
          <ul className="space-y-1 text-sm text-arkive-muted">
            {others.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center gap-2 rounded-xl px-2.5 py-2 transition hover:bg-white/[0.04]"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-arkive-accent/40 to-arkive-accent2/30 text-[11px] font-bold text-white ring-1 ring-white/15">
                  {(u.display_name || u.email || '?').trim().charAt(0).toUpperCase()}
                </span>
                <span className="text-arkive-text">{u.display_name}</span>
                <span>{u.email}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 capitalize ${
                    u.status === 'active'
                      ? 'bg-emerald-500/12 text-emerald-300 ring-emerald-400/30'
                      : u.status === 'rejected'
                        ? 'bg-red-500/12 text-red-300 ring-red-400/30'
                        : 'bg-amber-500/12 text-amber-300 ring-amber-400/30'
                  }`}
                >
                  {u.status}
                </span>
                {u.is_instance_admin && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-arkive-accent/15 px-2 py-0.5 text-[10px] font-semibold text-violet-300 ring-1 ring-arkive-accent/30">
                    <ShieldCheck size={10} /> admin
                  </span>
                )}
                {u.id !== user?.id && (
                  <span className="ml-auto flex flex-wrap gap-2 text-xs">
                    {u.status === 'active' && (
                      <button
                        type="button"
                        className="cursor-pointer rounded-md px-1.5 py-0.5 transition hover:bg-white/[0.07] hover:text-arkive-accent2"
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
                        className="cursor-pointer rounded-md px-1.5 py-0.5 transition hover:bg-white/[0.07] hover:text-arkive-accent2"
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
                      className="cursor-pointer rounded-md px-1.5 py-0.5 transition hover:bg-white/[0.07] hover:text-arkive-accent2"
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
                      className="cursor-pointer rounded-md px-1.5 py-0.5 transition hover:bg-red-500/12 hover:text-red-300"
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

      <h2 className="mb-3 flex items-center gap-2.5 font-display text-xl font-semibold">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-arkive-accent/25 to-arkive-accent2/20 text-arkive-accent2 ring-1 ring-white/10">
          <Database size={16} />
        </span>
        <span className="text-iridescent">Storage</span>
      </h2>

      <motion.form
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={onCreate}
        className="glass glass-hairline mb-8 rounded-3xl p-5"
      >
        <h2 className="mb-3 flex items-center gap-2.5 font-display text-lg font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-arkive-accent/25 to-arkive-accent2/20 text-arkive-accent2 ring-1 ring-white/10">
            <Plus size={15} />
          </span>
          Add backend
        </h2>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-arkive-muted uppercase">Name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-glass"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-arkive-muted uppercase">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 's3' | 'nfs')}
              className="input-glass cursor-pointer [&>option]:bg-arkive-surface"
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
                <span className="mb-1.5 block text-xs font-medium tracking-wide text-arkive-muted uppercase">{label}</span>
                <input
                  required={key !== 'region'}
                  type={key.includes('secret') ? 'password' : 'text'}
                  value={String(s3[key])}
                  onChange={(e) => setS3({ ...s3, [key]: e.target.value })}
                  className="input-glass"
                />
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm text-arkive-muted">
              <input
                type="checkbox"
                className="h-4 w-4 accent-arkive-accent"
                checked={s3.use_ssl}
                onChange={(e) => setS3({ ...s3, use_ssl: e.target.checked })}
              />
              Use SSL
            </label>
            <label className="flex items-center gap-2 text-sm text-arkive-muted">
              <input
                type="checkbox"
                className="h-4 w-4 accent-arkive-accent"
                checked={s3.force_path_style}
                onChange={(e) => setS3({ ...s3, force_path_style: e.target.checked })}
              />
              Path-style (MinIO)
            </label>
          </div>
        ) : (
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-arkive-muted uppercase">Mount path inside API container</span>
            <input
              required
              value={mountPath}
              onChange={(e) => setMountPath(e.target.value)}
              className="input-glass font-mono text-sm"
            />
            <span className="mt-1 block text-xs text-arkive-muted">
              Compose ships a demo volume at <code>/mnt/arkive-nfs</code>. For a real NFS share, mount it into the API service.
            </span>
          </label>
        )}

        <button
          type="submit"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-iridescent px-3.5 py-2 text-sm font-semibold text-white shadow-[0_4px_20px_rgba(139,92,246,0.35)] transition hover:brightness-110 hover:shadow-[0_6px_28px_rgba(139,92,246,0.5)] disabled:opacity-50 mt-4"
        >
          Test &amp; save
        </button>
      </motion.form>

      <ul className="mb-8 space-y-3">
        {backends.map((b) => (
          <li
            key={b.id}
            className="glass rounded-2xl px-4 py-3 transition hover:border-white/12"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">
                  {b.name}{' '}
                  {b.is_default && (
                    <span className="ml-1 rounded-full bg-arkive-accent/15 px-2 py-0.5 text-[10px] font-semibold text-violet-300 ring-1 ring-arkive-accent/30">
                      default
                    </span>
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
                  className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/8 bg-white/[0.04] px-2.5 py-1 text-xs text-arkive-muted backdrop-blur-md transition hover:border-arkive-accent/50 hover:text-arkive-text disabled:opacity-50"
                >
                  <SearchCheck size={12} /> Test
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
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/8 bg-white/[0.04] px-2.5 py-1 text-xs text-arkive-muted backdrop-blur-md transition hover:border-arkive-accent/50 hover:text-arkive-text disabled:opacity-50"
                  >
                    <Star size={12} /> Make default
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
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/8 px-2.5 py-1 text-xs text-arkive-muted transition hover:border-red-400/50 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <section className="glass glass-hairline rounded-3xl p-5">
        <h2 className="mb-3 flex items-center gap-2.5 font-display text-lg font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-arkive-accent/25 to-arkive-accent2/20 text-arkive-accent2 ring-1 ring-white/10">
            <HardDrive size={15} />
          </span>
          Assign workspace backend
        </h2>
        <p className="mb-3 text-xs text-arkive-muted">
          By default only the storage pointer changes. Enable copy below to migrate current files, trash,
          and versions to the new store first. Large vaults may take a while.
        </p>
        <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-arkive-muted">
          <input
            type="checkbox"
            checked={copyOnAssign}
            onChange={(e) => setCopyOnAssign(e.target.checked)}
            className="h-4 w-4 accent-arkive-accent"
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
                className="input-glass !w-auto cursor-pointer !py-1.5 text-sm disabled:opacity-60 [&>option]:bg-arkive-surface"
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
