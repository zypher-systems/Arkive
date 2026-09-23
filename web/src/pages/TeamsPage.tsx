import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type Workspace, type WorkspaceMember } from '../lib/api';
import { copyText } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { useConfirm } from '../lib/confirm';
import { useWorkspaces } from '../lib/workspaces';
import { useI18n, type TKey } from '../i18n';
import { useToast } from '../components/Toast';
import { Button, IconButton } from '../components/ui/Button';
import { Avatar, Badge, EmptyState, Section } from '../components/ui/Card';
import { Field, Input, Select } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Notice } from '../components/ui/Notice';
import { PageHeader } from '../components/ui/PageHeader';
import { Spinner } from '../components/ui/Spinner';
import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  FolderOpenIcon,
  KeyIcon,
  LogoutIcon,
  PlusIcon,
  RefreshIcon,
  SendIcon,
  TeamIcon,
  UserMinusIcon,
  UserPlusIcon,
} from '../components/icons';

const ROLE_KEYS: Record<string, TKey> = {
  owner: 'teams.roles.owner',
  admin: 'teams.roles.admin',
  member: 'teams.roles.member',
  viewer: 'teams.roles.viewer',
};

function RoleBadge({ role }: { role?: string }) {
  const { t } = useI18n();
  if (!role) return null;
  return <Badge tone={role === 'owner' ? 'accent' : role === 'admin' ? 'info' : 'neutral'}>{ROLE_KEYS[role] ? t(ROLE_KEYS[role]) : role}</Badge>;
}

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (w: Workspace) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onCreated(await api.createTeam(name.trim()));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('teams.createFailed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('teams.createTitle')}
      subtitle={t('teams.createSubtitle')}
      icon={<TeamIcon size={17} />}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="create-team" variant="primary" loading={busy} disabled={!name.trim()}>
            {t('teams.create')}
          </Button>
        </>
      }
    >
      <form id="create-team" onSubmit={submit} className="space-y-3">
        <Field label={t('teams.name')} error={error || undefined}>
          {({ id }) => (
            <Input id={id} data-autofocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('teams.namePlaceholder')} />
          )}
        </Field>
      </form>
    </Modal>
  );
}

function JoinDialog({ onClose, onJoined }: { onClose: () => void; onJoined: (w: Workspace) => void }) {
  const { t } = useI18n();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onJoined(await api.joinTeam(token.trim()));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('teams.joinFailed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('teams.joinTitle')}
      subtitle={t('teams.joinSubtitle')}
      icon={<UserPlusIcon size={17} />}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="join-team" variant="primary" loading={busy} disabled={!token.trim()}>
            {t('teams.join')}
          </Button>
        </>
      }
    >
      <form id="join-team" onSubmit={submit}>
        <Field label={t('teams.inviteToken')} error={error || undefined}>
          {({ id }) => (
            <Input id={id} data-autofocus required value={token} onChange={(e) => setToken(e.target.value)} spellCheck={false} autoComplete="off" className="font-mono" />
          )}
        </Field>
      </form>
    </Modal>
  );
}

function TeamDetail({
  team,
  onChanged,
  onLeft,
}: {
  team: Workspace;
  onChanged: () => Promise<void>;
  onLeft: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();
  const { ask, dialog } = useConfirm();
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [token, setToken] = useState(team.invite_token || '');
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const canManage = team.role === 'owner' || team.role === 'admin';

  const loadMembers = useCallback(async () => {
    setMembers(await api.members(team.id));
  }, [team.id]);

  useEffect(() => {
    setMembers(null);
    setError('');
    setToken(team.invite_token || '');
    void loadMembers().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [team.id, team.invite_token, loadMembers]);

  async function rotate() {
    try {
      const res = await api.rotateInvite(team.id);
      setToken(res.invite_token);
      toast({ message: t('teams.rotated') });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function sendInvite(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setError('');
    try {
      await api.sendInvite(team.id, email.trim());
      toast({ message: t('teams.inviteSent', { email: email.trim() }) });
      setEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('teams.sendFailed'));
    } finally {
      setSending(false);
    }
  }

  function remove(m: WorkspaceMember) {
    const self = m.user_id === user?.id;
    ask({
      title: self ? t('teams.leaveTitle') : t('teams.removeTitle'),
      message: self ? t('teams.leaveMessage', { team: team.name }) : t('teams.removeMessage', { name: m.display_name || m.email }),
      confirmLabel: self ? t('teams.leave') : t('teams.remove'),
      run: async () => {
        try {
          await api.removeMember(team.id, m.user_id);
          if (self) {
            toast({ message: t('teams.left', { team: team.name }) });
            onLeft();
          } else {
            await loadMembers();
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          throw e;
        }
      },
    });
  }

  async function changeRole(m: WorkspaceMember, role: string) {
    try {
      await api.updateMember(team.id, m.user_id, role);
      await loadMembers();
      toast({ message: t('teams.roleChanged', { name: m.display_name || m.email }) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="panel flex flex-wrap items-center gap-4 px-5 py-4 sm:px-6">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-info-soft text-info">
          <TeamIcon size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-ink">{team.name}</h2>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <RoleBadge role={team.role} />
            {members && <span className="whitespace-nowrap">{t('teams.memberCount', { count: members.length })}</span>}
          </p>
        </div>
        <Link
          to={`/w/${team.id}`}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-3.5 text-base font-medium text-ink shadow-xs transition hover:border-strong hover:bg-hover coarse:h-11"
        >
          <FolderOpenIcon size={15} /> {t('teams.openFiles')}
        </Link>
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      <Section title={t('teams.inviteTitle')} description={canManage ? t('teams.inviteDescription') : t('teams.inviteDescriptionMember')}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 basis-full items-center gap-2 rounded-lg border border-line bg-inset px-3 py-2 sm:basis-0">
            <KeyIcon size={15} className="shrink-0 text-faint" />
            <code className="min-w-0 flex-1 truncate font-mono text-sm text-ink">{token || '—'}</code>
          </div>
          <Button
            variant="secondary"
            size="md"
            disabled={!token}
            icon={copied ? <CheckIcon size={14} className="text-ok" /> : <CopyIcon size={14} />}
            onClick={() =>
              void copyText(token).then((ok) => {
                if (!ok) return;
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? t('common.copied') : t('common.copy')}
          </Button>
          {canManage && (
            <Button variant="secondary" size="md" icon={<RefreshIcon size={14} />} onClick={() => void rotate()}>
              {t('teams.rotate')}
            </Button>
          )}
        </div>
        {canManage && (
          <form onSubmit={sendInvite} className="mt-4 flex flex-wrap items-end gap-2">
            <Field label={t('teams.inviteEmail')} className="min-w-[12rem] flex-1">
              {({ id }) => (
                <Input id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
              )}
            </Field>
            <Button type="submit" variant="primary" loading={sending} icon={<SendIcon size={14} />}>
              {t('teams.sendInvite')}
            </Button>
          </form>
        )}
      </Section>

      <Section title={t('teams.membersTitle')} description={t('teams.membersDescription')}>
        {members === null ? (
          <div className="flex justify-center py-4">
            <Spinner className="text-faint" />
          </div>
        ) : (
          <ul className="-my-2 divide-y divide-line">
            {members.map((m) => {
              const self = m.user_id === user?.id;
              return (
                <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-3">
                  <Avatar name={m.display_name || m.email} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium text-ink">
                      {m.display_name || m.email}
                      {self && <span className="ml-1.5 text-sm font-normal text-muted">{t('teams.you')}</span>}
                    </p>
                    <p className="truncate text-sm text-muted">{m.email}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {canManage && m.role !== 'owner' && !self ? (
                      <Select
                        value={m.role}
                        onChange={(e) => void changeRole(m, e.target.value)}
                        aria-label={t('teams.roleFor', { name: m.display_name || m.email })}
                        className="!w-32"
                      >
                        <option value="admin">{t('teams.roles.admin')}</option>
                        <option value="member">{t('teams.roles.member')}</option>
                        <option value="viewer">{t('teams.roles.viewer')}</option>
                      </Select>
                    ) : (
                      <RoleBadge role={m.role} />
                    )}
                    {m.role !== 'owner' && (canManage || self) && (
                      <IconButton
                        label={self ? t('teams.leave') : t('teams.removeName', { name: m.display_name || m.email })}
                        size="md"
                        className="hover:!bg-danger-soft hover:!text-danger"
                        onClick={() => remove(m)}
                      >
                        {self ? <LogoutIcon size={15} /> : <UserMinusIcon size={15} />}
                      </IconButton>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      {dialog}
    </div>
  );
}

export default function TeamsPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { refresh: refreshSidebar } = useWorkspaces();
  const [params, setParams] = useSearchParams();
  const [teams, setTeams] = useState<Workspace[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [dialog, setDialog] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState('');
  const selectedId = params.get('team');

  const load = useCallback(async () => {
    const all = await api.workspaces();
    const list = all.filter((w) => w.type === 'team');
    setTeams(list);
    void Promise.all(
      list.map((w) =>
        api
          .members(w.id)
          .then((m) => [w.id, m.length] as const)
          .catch(() => [w.id, -1] as const),
      ),
    ).then((pairs) => setCounts(Object.fromEntries(pairs.filter(([, n]) => n >= 0))));
  }, []);

  useEffect(() => {
    void load().catch((e) => {
      setTeams([]);
      setError(e instanceof Error ? e.message : String(e));
    });
  }, [load]);

  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('team', id);
    else next.delete('team');
    setParams(next, { replace: true });
  };

  const current = teams?.find((w) => w.id === selectedId) || teams?.[0];

  const after = async (w: Workspace, msg: string) => {
    await load();
    void refreshSidebar();
    select(w.id);
    toast({ message: msg });
  };

  return (
    <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 pb-24 lg:px-6 lg:pb-8">
      <div className="max-w-5xl">
        <PageHeader
          title={t('teams.title')}
          subtitle={t('teams.subtitle')}
          actions={
            <div className="hidden gap-2 sm:flex">
              <Button variant="secondary" icon={<UserPlusIcon size={15} />} onClick={() => setDialog('join')}>
                {t('teams.join')}
              </Button>
              <Button variant="primary" icon={<PlusIcon size={15} />} onClick={() => setDialog('create')}>
                {t('teams.create')}
              </Button>
            </div>
          }
        />
        <div className="mb-4 grid grid-cols-2 gap-2 sm:hidden">
          <Button variant="secondary" icon={<UserPlusIcon size={15} />} onClick={() => setDialog('join')}>
            {t('teams.join')}
          </Button>
          <Button variant="primary" icon={<PlusIcon size={15} />} onClick={() => setDialog('create')}>
            {t('teams.create')}
          </Button>
        </div>
        {error && <Notice kind="error" className="mb-4">{error}</Notice>}

        {teams === null ? (
          <div className="flex justify-center py-16">
            <Spinner className="text-faint" />
          </div>
        ) : teams.length === 0 ? (
          <div className="panel">
            <EmptyState
              icon={<TeamIcon size={26} />}
              title={t('teams.emptyTitle')}
              hint={t('teams.emptyHint')}
              action={
                <>
                  <Button variant="primary" icon={<PlusIcon size={15} />} onClick={() => setDialog('create')}>
                    {t('teams.create')}
                  </Button>
                  <Button variant="secondary" icon={<UserPlusIcon size={15} />} onClick={() => setDialog('join')}>
                    {t('teams.joinWithToken')}
                  </Button>
                </>
              }
            />
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
            <nav aria-label={t('teams.listLabel')} className="lg:sticky lg:top-0 lg:self-start">
              <p className="mb-2 px-1 text-2xs font-semibold tracking-wider text-faint uppercase">{t('teams.yourTeams')}</p>
              <ul className="panel divide-y divide-line overflow-hidden">
                {teams.map((w) => {
                  const active = w.id === current?.id;
                  return (
                    <li key={w.id}>
                      <button
                        type="button"
                        aria-current={active ? 'true' : undefined}
                        onClick={() => select(w.id)}
                        className={`relative flex w-full items-center gap-3 px-3.5 py-3 text-left transition coarse:py-3.5 ${
                          active ? 'bg-row-selected' : 'hover:bg-hover'
                        }`}
                      >
                        {active && <span aria-hidden className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full bg-accent" />}
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info">
                          <TeamIcon size={15} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-base font-medium text-ink">{w.name}</span>
                          <span className="block truncate text-xs text-muted">
                            {w.role && ROLE_KEYS[w.role] ? t(ROLE_KEYS[w.role]) : w.role}
                            {counts[w.id] !== undefined && ` · ${t('teams.memberCount', { count: counts[w.id] })}`}
                          </span>
                        </span>
                        <ChevronRightIcon size={14} className="shrink-0 text-faint lg:hidden" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
            {current && (
              <TeamDetail
                key={current.id}
                team={current}
                onChanged={load}
                onLeft={() => {
                  select(null);
                  void load();
                  void refreshSidebar();
                }}
              />
            )}
          </div>
        )}
      </div>

      {dialog === 'create' && (
        <CreateDialog onClose={() => setDialog(null)} onCreated={(w) => void after(w, t('teams.created', { team: w.name }))} />
      )}
      {dialog === 'join' && (
        <JoinDialog onClose={() => setDialog(null)} onJoined={(w) => void after(w, t('teams.joined', { team: w.name }))} />
      )}
    </div>
  );
}
