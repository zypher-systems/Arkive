import { useEffect, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { api, type Workspace, type WorkspaceMember } from '../lib/api';
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
        <h1 className="font-display text-3xl font-bold tracking-tight">Teams</h1>
        <p className="mt-1 text-sm text-arkive-muted">
          Shared workspaces with invite tokens. Send an email when SMTP is configured.
        </p>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <motion.form
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={createTeam}
          className="rounded-2xl border border-arkive-border bg-arkive-surface/70 p-5"
        >
          <h2 className="mb-3 font-display text-lg font-semibold">Create team</h2>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Team name"
            className="mb-3 w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2 outline-none focus:ring-2 focus:ring-arkive-amber/40"
          />
          <button
            type="submit"
            className="rounded-lg bg-gradient-to-r from-arkive-orange to-arkive-amber px-4 py-2 text-sm font-semibold text-black"
          >
            Create
          </button>
        </motion.form>

        <motion.form
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          onSubmit={joinTeam}
          className="rounded-2xl border border-arkive-border bg-arkive-surface/70 p-5"
        >
          <h2 className="mb-3 font-display text-lg font-semibold">Join with invite</h2>
          <input
            required
            value={joinToken}
            onChange={(e) => setJoinToken(e.target.value)}
            placeholder="Invite token"
            className="mb-3 w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-arkive-amber/40"
          />
          <button
            type="submit"
            className="rounded-lg border border-arkive-border px-4 py-2 text-sm hover:border-arkive-amber/40"
          >
            Join team
          </button>
        </motion.form>
      </div>

      <div className="mt-8 rounded-2xl border border-arkive-border bg-arkive-surface/70 p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="font-display text-lg font-semibold">Your teams</h2>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2 text-sm"
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
            <div className="mb-5 rounded-xl border border-arkive-border bg-arkive-panel/40 p-4">
              <p className="mb-2 text-sm text-arkive-muted">Invite token</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-lg bg-arkive-bg px-3 py-2 font-mono text-xs text-arkive-glow">
                  {inviteToken || '—'}
                </code>
                <button
                  type="button"
                  onClick={() => void copyInvite()}
                  className="rounded-lg border border-arkive-border px-3 py-1.5 text-xs hover:border-arkive-amber/40"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => void rotate().catch((e) => setError(String(e)))}
                    className="rounded-lg border border-arkive-border px-3 py-1.5 text-xs hover:border-arkive-amber/40"
                  >
                    Rotate
                  </button>
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
                    className="min-w-48 flex-1 rounded-lg border border-arkive-border bg-arkive-bg px-3 py-1.5 text-sm"
                  />
                  <button
                    type="submit"
                    className="rounded-lg border border-arkive-border px-3 py-1.5 text-xs hover:border-arkive-amber/40"
                  >
                    Send invite
                  </button>
                </form>
              )}
              {inviteInfo && <p className="mt-2 text-xs text-arkive-muted">{inviteInfo}</p>}
            </div>

            <ul className="divide-y divide-arkive-border">
              {members.map((m) => (
                <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div>
                    <div className="font-medium">{m.display_name}</div>
                    <div className="text-arkive-muted">{m.email}</div>
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
                        className="rounded-md border border-arkive-border bg-arkive-bg px-2 py-1 text-xs"
                      >
                        <option value="admin">admin</option>
                        <option value="member">member</option>
                        <option value="viewer">viewer</option>
                      </select>
                    ) : (
                      <span className="rounded-md border border-arkive-border px-2 py-1 text-xs text-arkive-muted">
                        {m.role}
                      </span>
                    )}
                    {(canManage || m.user_id === user?.id) && m.role !== 'owner' && (
                      <button
                        type="button"
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
                        className="text-xs text-arkive-muted hover:text-red-300"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
