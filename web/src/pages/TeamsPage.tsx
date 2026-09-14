import { useEffect, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  Check,
  Copy,
  KeyRound,
  Mail,
  RefreshCw,
  Send,
  UserPlus,
  UserX,
  Users,
} from 'lucide-react';
import { api, type Workspace, type WorkspaceMember } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useAuth } from '../lib/auth';
import { useConfirm } from '../lib/confirm';

export function TeamsPage() {
  const { user } = useAuth();
  const [teams, setTeams] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [inviteToken, setInviteToken] = useState('');
  const [name, setName] = useState('');
  const [joinToken, setJoinToken] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteInfo, setInviteInfo] = useState('');
  const { ask, dialog: confirmDialog } = useConfirm();

  async function refresh() {
    const all = await api.workspaces();
    const t = all.filter((w) => w.type === 'team');
    setTeams(t);
    const next = selected && t.some((x) => x.id === selected) ? selected : t[0]?.id || '';
    setSelected(next);
    if (next) {
      const m = await api.members(next);
      setMembers(m);
      const team = t.find((x) => x.id === next);
      setInviteToken(team?.invite_token || '');
    } else {
      setMembers([]);
      setInviteToken('');
    }
  }

  useEffect(() => {
    void refresh().catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, []);

  useEffect(() => {
    if (!selected) return;
    void (async () => {
      setMembers(await api.members(selected));
      const team = teams.find((t) => t.id === selected);
      setInviteToken(team?.invite_token || '');
    })().catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, [selected]);

  async function createTeam(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const ws = await api.createTeam(name);
      setName('');
      await refresh();
      setSelected(ws.id);
      setInviteToken(ws.invite_token || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create team');
    }
  }

  async function joinTeam(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const ws = await api.joinTeam(joinToken.trim());
      setJoinToken('');
      await refresh();
      setSelected(ws.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join');
    }
  }

  async function rotate() {
    if (!selected) return;
    const res = await api.rotateInvite(selected);
    setInviteToken(res.invite_token);
    await refresh();
  }

  async function copyInvite() {
    if (!inviteToken) return;
    await navigator.clipboard.writeText(inviteToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const current = teams.find((t) => t.id === selected);
  const canManage = current?.role === 'owner' || current?.role === 'admin';

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          <span className="text-iridescent">Teams</span>
        </h1>
        <p className="mt-1 text-sm text-arkive-muted">
          Shared workspaces with invite tokens. Send an email when SMTP is configured.
        </p>
      </div>

      {error && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
          <AlertCircle size={15} className="shrink-0" />
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <motion.form
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={createTeam}
          className="glass glass-hairline rounded-3xl p-5"
        >
          <h2 className="mb-3 flex items-center gap-2.5 font-display text-lg font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-arkive-accent/25 to-arkive-accent2/20 text-arkive-accent2 ring-1 ring-white/10">
              <Users size={15} />
            </span>
            Create team
          </h2>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Team name"
            className="input-glass mb-3"
          />
          <Button type="submit" variant="primary" icon={<UserPlus size={14} />} className="font-semibold">
            Create
          </Button>
        </motion.form>

        <motion.form
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          onSubmit={joinTeam}
          className="glass glass-hairline rounded-3xl p-5"
        >
          <h2 className="mb-3 flex items-center gap-2.5 font-display text-lg font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-arkive-accent/25 to-arkive-accent2/20 text-arkive-accent2 ring-1 ring-white/10">
              <KeyRound size={15} />
            </span>
            Join with invite
          </h2>
          <input
            required
            value={joinToken}
            onChange={(e) => setJoinToken(e.target.value)}
            placeholder="Invite token"
            className="input-glass mb-3 font-mono"
          />
          <Button type="submit" variant="glass" icon={<UserPlus size={14} />}>
            Join team
          </Button>
        </motion.form>
      </div>

      <Card className="mt-8 p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="font-display text-lg font-semibold">Your teams</h2>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="input-glass w-auto cursor-pointer !py-1.5 text-sm [&>option]:bg-arkive-surface"
          >
            {teams.length === 0 && <option value="">No teams yet</option>}
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {current && (
          <>
            <div className="mb-5 rounded-2xl border border-white/7 bg-black/20 p-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold tracking-[0.12em] text-arkive-muted uppercase">
                <KeyRound size={12} className="text-arkive-accent2" /> Invite token
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-xl border border-white/8 bg-black/35 px-3 py-2 font-mono text-xs text-arkive-accent2 shadow-[0_0_14px_rgba(34,211,238,0.12)]">
                  {inviteToken || '—'}
                </code>
                <Button
                  size="xs"
                  variant="glass"
                  icon={copied ? <Check size={12} className="text-emerald-300" /> : <Copy size={12} />}
                  onClick={() => void copyInvite()}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                {canManage && (
                  <Button
                    size="xs"
                    variant="glass"
                    icon={<RefreshCw size={12} />}
                    onClick={() => void rotate().catch((e) => setError(String(e)))}
                  >
                    Rotate
                  </Button>
                )}
              </div>
              {canManage && (
                <form
                  className="mt-3 flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setError('');
                    setInviteInfo('');
                    void api
                      .sendInvite(selected, inviteEmail)
                      .then(() => {
                        setInviteInfo(`Invite sent to ${inviteEmail}`);
                        setInviteEmail('');
                      })
                      .catch((err) => setError(err instanceof Error ? err.message : 'Send failed'));
                  }}
                >
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="Send invite to email"
                    className="input-glass min-w-48 flex-1 !py-1.5 text-sm"
                  />
                  <Button type="submit" size="sm" variant="glass" icon={<Send size={12} />}>
                    Send invite
                  </Button>
                </form>
              )}
              {inviteInfo && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-300">
                  <Mail size={12} /> {inviteInfo}
                </p>
              )}
            </div>

            <ul className="divide-y divide-white/5">
              {members.map((m) => (
                <li key={m.user_id} className="group flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-arkive-accent/40 to-arkive-accent2/30 font-display text-sm font-bold text-white ring-1 ring-white/15">
                      {(m.display_name || m.email || '?').trim().charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{m.display_name}</div>
                      <div className="truncate text-xs text-arkive-muted">{m.email}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {canManage && m.role !== 'owner' ? (
                      <select
                        value={m.role}
                        onChange={(e) =>
                          void api
                            .updateMember(selected, m.user_id, e.target.value)
                            .then(refresh)
                            .catch((err) => setError(String(err)))
                        }
                        className="cursor-pointer rounded-lg border border-white/8 bg-black/30 px-2 py-1 text-xs text-arkive-muted outline-none transition hover:border-arkive-accent/50 hover:text-arkive-text [&>option]:bg-arkive-surface"
                      >
                        <option value="admin">admin</option>
                        <option value="member">member</option>
                        <option value="viewer">viewer</option>
                      </select>
                    ) : (
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${
                        m.role === 'owner'
                          ? 'bg-arkive-accent/15 text-violet-300 ring-arkive-accent/30'
                          : 'bg-white/6 text-arkive-muted ring-white/10'
                      }`}>
                        {m.role}
                      </span>
                    )}
                    {(canManage || m.user_id === user?.id) && m.role !== 'owner' && (
                      <Button
                        size="xs"
                        variant="ghost"
                        icon={<UserX size={12} />}
                        className="hover:!bg-red-500/12 hover:!text-red-300"
                        onClick={() =>
                          ask({
                            title: 'Remove member',
                            message: `Remove ${m.display_name || m.email} from this team?`,
                            confirmLabel: 'Remove',
                            run: async () => {
                              try {
                                await api.removeMember(selected, m.user_id);
                                await refresh();
                              } catch (err) {
                                setError(String(err));
                                throw err;
                              }
                            },
                          })
                        }
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      {confirmDialog}
    </div>
  );
}
