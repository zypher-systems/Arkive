import { useEffect, useState, type FormEvent } from 'react';
import {
  CheckIcon,
  CopyIcon,
  KeyIcon,
  MailIcon,
  RefreshIcon,
  SendIcon,
  UserMinusIcon,
  UserPlusIcon,
} from '../components/icons';
import { api, type Workspace, type WorkspaceMember } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Notice } from '../components/ui/Notice';
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
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Teams</h1>
        <p className="mt-0.5 text-[13px] text-muted">
          Shared workspaces with invite tokens. Send an email when SMTP is configured.
        </p>
      </div>

      {error && <Notice kind="error" className="mb-4">{error}</Notice>}

      <div className="grid gap-4 lg:grid-cols-2">
        <form
          onSubmit={createTeam}
          className="panel p-5"
        >
          <h2 className="mb-3 text-[15px] font-semibold">
            Create team
          </h2>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Team name"
            className="input-field mb-3"
          />
          <Button type="submit" variant="primary" icon={<UserPlusIcon size={14} />}>
            Create
          </Button>
        </form>

        <form
          onSubmit={joinTeam}
          className="panel p-5"
        >
          <h2 className="mb-3 text-[15px] font-semibold">
            Join with invite
          </h2>
          <input
            required
            value={joinToken}
            onChange={(e) => setJoinToken(e.target.value)}
            placeholder="Invite token"
            className="input-field mb-3 font-mono"
          />
          <Button type="submit" variant="secondary" icon={<UserPlusIcon size={14} />}>
            Join team
          </Button>
        </form>
      </div>

      <Card className="mt-6 p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-[15px] font-semibold">Your teams</h2>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="input-field w-auto cursor-pointer !py-1.5 text-sm"
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
            <div className="mb-5 rounded-md border border-line bg-inset p-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
                <KeyIcon size={12} /> Invite token
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded border border-line bg-surface px-3 py-2 font-mono text-xs text-accent-strong">
                  {inviteToken || '—'}
                </code>
                <Button
                  size="xs"
                  variant="secondary"
                  icon={copied ? <CheckIcon size={12} className="text-ok" /> : <CopyIcon size={12} />}
                  onClick={() => void copyInvite()}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                {canManage && (
                  <Button
                    size="xs"
                    variant="secondary"
                    icon={<RefreshIcon size={12} />}
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
                    className="input-field min-w-48 flex-1 !py-1.5 text-sm"
                  />
                  <Button type="submit" size="sm" variant="secondary" icon={<SendIcon size={12} />}>
                    Send invite
                  </Button>
                </form>
              )}
              {inviteInfo && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-ok">
                  <MailIcon size={12} /> {inviteInfo}
                </p>
              )}
            </div>

            <ul className="divide-y divide-line">
              {members.map((m) => (
                <li key={m.user_id} className="group flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-hover text-[13px] font-semibold text-muted">
                      {(m.display_name || m.email || '?').trim().charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{m.display_name}</div>
                      <div className="truncate text-xs text-muted">{m.email}</div>
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
                        className="input-field w-auto cursor-pointer !py-1 text-xs"
                      >
                        <option value="admin">admin</option>
                        <option value="member">member</option>
                        <option value="viewer">viewer</option>
                      </select>
                    ) : (
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${
                        m.role === 'owner'
                          ? 'bg-accent-soft text-accent-strong ring-accent/40'
                          : 'bg-inset text-muted ring-line'
                      }`}>
                        {m.role}
                      </span>
                    )}
                    {(canManage || m.user_id === user?.id) && m.role !== 'owner' && (
                      <Button
                        size="xs"
                        variant="ghost"
                        icon={<UserMinusIcon size={12} />}
                        className="hover:!bg-danger-soft hover:!text-danger"
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
