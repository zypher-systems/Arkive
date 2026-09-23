import { useMemo, useState } from 'react';
import { api, isMissingEndpoint, type User } from '../../lib/api';
import { useConfirm } from '../../lib/confirm';
import { useI18n } from '../../i18n';
import { useToast } from '../../components/Toast';
import { Avatar, Badge, EmptyState } from '../../components/ui/Card';
import { Button, IconButton } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { DropdownMenu, type MenuItem } from '../../components/ui/Menu';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import {
  AdminIcon,
  MoreIcon,
  SearchIcon,
  ShieldIcon,
  TrashIcon,
  UserCheckIcon,
  UserMinusIcon,
  UserIcon,
} from '../../components/icons';
import { bytesToGb, errText, gbToBytes } from './shared';

type Props = { users: User[] | null; me: User; refresh: () => Promise<void> };

function StatusBadge({ status }: { status: User['status'] }) {
  const { t } = useI18n();
  const tone = status === 'active' ? 'ok' : status === 'pending' ? 'accent' : status === 'rejected' ? 'danger' : 'neutral';
  return <Badge tone={tone}>{t(`admin.users.status.${status}`)}</Badge>;
}

function QuotaModal({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [value, setValue] = useState(bytesToGb(user.quota_bytes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = user.display_name || user.email;
  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.setUserQuota(user.id, gbToBytes(value));
      toast({ message: t('admin.users.quotaSaved') });
      onSaved();
      onClose();
    } catch (e) {
      setError(errText(e, t('common.failed')));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('admin.users.quotaTitle', { name })}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="quota-form" loading={busy}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="quota-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label={t('admin.users.quotaLabel')} hint={t('admin.users.quotaHint')} error={error || undefined}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              data-autofocus
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              aria-describedby={describedBy}
              placeholder={t('admin.users.unlimited')}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}

export function UsersTab({ users, me, refresh }: Props) {
  const { t, formatBytes, formatRelative, formatDateTime } = useI18n();
  const { toast } = useToast();
  const { ask, dialog } = useConfirm();
  const [query, setQuery] = useState('');
  const [quotaUser, setQuotaUser] = useState<User | null>(null);
  const [busyId, setBusyId] = useState('');

  const pending = (users || []).filter((u) => u.status === 'pending');
  const others = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (users || [])
      .filter((u) => u.status !== 'pending')
      .filter((u) => !q || u.email.toLowerCase().includes(q) || (u.display_name || '').toLowerCase().includes(q));
  }, [users, query]);
  const has2fa = (users || []).some((u) => u.two_factor_enabled !== undefined);

  async function run(id: string, fn: () => Promise<unknown>, ok: string) {
    setBusyId(id);
    try {
      await fn();
      await refresh();
      toast({ message: ok });
    } catch (e) {
      toast({ tone: 'error', message: errText(e, t('common.failed')) });
    } finally {
      setBusyId('');
    }
  }

  function menuFor(u: User): MenuItem[] {
    const self = u.id === me.id;
    const items: MenuItem[] = [];
    if (!self) {
      if (u.status === 'active')
        items.push({
          id: 'disable',
          label: t('admin.users.disable'),
          icon: <UserMinusIcon size={15} />,
          onSelect: () => void run(u.id, () => api.disableUser(u.id), t('admin.users.disabled', { email: u.email })),
        });
      if (u.status === 'disabled' || u.status === 'rejected')
        items.push({
          id: 'enable',
          label: t('admin.users.enable'),
          icon: <UserCheckIcon size={15} />,
          onSelect: () => void run(u.id, () => api.approveUser(u.id), t('admin.users.enabled', { email: u.email })),
        });
      items.push({
        id: 'admin',
        label: u.is_instance_admin ? t('admin.users.demote') : t('admin.users.promote'),
        icon: <AdminIcon size={15} />,
        onSelect: () =>
          void run(
            u.id,
            () => api.setInstanceAdmin(u.id, !u.is_instance_admin),
            u.is_instance_admin ? t('admin.users.demoted', { email: u.email }) : t('admin.users.promoted', { email: u.email }),
          ),
      });
    }
    items.push({ id: 'quota', label: t('admin.users.setQuota'), icon: <UserIcon size={15} />, onSelect: () => setQuotaUser(u) });
    if (!self && u.two_factor_enabled) {
      items.push({
        id: '2fa',
        label: t('admin.users.resetTwoFactor'),
        icon: <ShieldIcon size={15} />,
        onSelect: () =>
          ask({
            title: t('admin.users.resetTitle'),
            message: t('admin.users.resetMessage', { email: u.email }),
            confirmLabel: t('admin.users.resetConfirm'),
            run: async () => {
              try {
                await api.adminResetTwoFactor(u.id);
                await refresh();
                toast({ message: t('admin.users.resetDone', { email: u.email }) });
              } catch (e) {
                toast({
                  tone: 'error',
                  message: isMissingEndpoint(e) ? t('admin.users.resetUnsupported') : errText(e, t('common.failed')),
                });
              }
            },
          }),
      });
    }
    if (!self) {
      items.push(
        { kind: 'separator', id: 'sep' },
        {
          id: 'delete',
          label: t('admin.users.delete'),
          icon: <TrashIcon size={15} />,
          danger: true,
          onSelect: () =>
            ask({
              title: t('admin.users.deleteTitle'),
              message: t('admin.users.deleteMessage', { email: u.email }),
              confirmLabel: t('admin.users.delete'),
              run: async () => {
                try {
                  await api.deleteUser(u.id);
                  await refresh();
                  toast({ message: t('admin.users.deleted', { email: u.email }) });
                } catch (e) {
                  toast({ tone: 'error', message: errText(e, t('common.failed')) });
                  throw e;
                }
              },
            }),
        },
      );
    }
    return items;
  }

  function actions(u: User) {
    const name = u.display_name || u.email;
    return busyId === u.id ? (
      <span className="flex h-8 w-8 items-center justify-center">
        <Spinner size={15} className="text-faint" />
      </span>
    ) : (
      <DropdownMenu
        align="end"
        label={t('admin.users.actionsFor', { name })}
        items={() => menuFor(u)}
        trigger={
          <IconButton label={t('admin.users.actionsFor', { name })}>
            <MoreIcon size={17} />
          </IconButton>
        }
      />
    );
  }

  const quota = (u: User) => (u.quota_bytes ? formatBytes(u.quota_bytes) : t('admin.users.unlimited'));
  const twoFa = (u: User) =>
    u.two_factor_enabled === undefined ? (
      <span className="text-faint">—</span>
    ) : u.two_factor_enabled ? (
      <Badge tone="ok" icon={<ShieldIcon size={10} />}>
        {t('admin.users.twoFactorOn')}
      </Badge>
    ) : (
      <span className="text-sm text-muted">{t('admin.users.twoFactorOff')}</span>
    );

  if (users === null) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size={20} className="text-faint" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {pending.length > 0 && (
        <section
          aria-labelledby="pending-title"
          className="overflow-hidden rounded-xl border border-accent-line bg-accent-soft"
        >
          <div className="px-5 pt-4 pb-2 sm:px-6">
            <h2 id="pending-title" className="text-md font-semibold text-ink">
              {t('admin.users.pendingTitle', { count: pending.length })}
            </h2>
            <p className="mt-0.5 text-sm text-muted">{t('admin.users.pendingDescription')}</p>
          </div>
          <ul className="divide-y divide-accent-line/50 px-2 pb-2">
            {pending.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 rounded-lg px-3 py-3">
                <Avatar name={u.display_name || u.email} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium text-ink">{u.display_name || u.email}</p>
                  <p className="truncate text-sm text-muted">
                    {u.email} · <span title={formatDateTime(u.created_at)}>{t('admin.users.requested', { when: formatRelative(u.created_at) })}</span>
                  </p>
                </div>
                <div className="flex gap-2 max-sm:w-full max-sm:[&>button]:flex-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busyId === u.id}
                    aria-label={t('admin.users.rejectFor', { email: u.email })}
                    icon={<UserMinusIcon size={14} />}
                    onClick={() =>
                      ask({
                        title: t('admin.users.rejectTitle'),
                        message: t('admin.users.rejectMessage', { email: u.email }),
                        confirmLabel: t('admin.users.reject'),
                        run: async () => {
                          try {
                            await api.rejectUser(u.id);
                            await refresh();
                            toast({ message: t('admin.users.rejected', { email: u.email }) });
                          } catch (e) {
                            toast({ tone: 'error', message: errText(e, t('common.failed')) });
                            throw e;
                          }
                        },
                      })
                    }
                  >
                    {t('admin.users.reject')}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={busyId === u.id}
                    aria-label={t('admin.users.approveFor', { email: u.email })}
                    icon={<UserCheckIcon size={14} />}
                    onClick={() => void run(u.id, () => api.approveUser(u.id), t('admin.users.approved', { email: u.email }))}
                  >
                    {t('admin.users.approve')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="users-title" className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-5 pt-5 pb-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 id="users-title" className="text-md font-semibold tracking-tight text-ink">
              {t('admin.users.title')}
            </h2>
            <p className="mt-0.5 text-sm text-muted">{t('admin.users.count', { count: others.length })}</p>
          </div>
          <Input
            type="search"
            icon={<SearchIcon size={15} />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('admin.users.search')}
            aria-label={t('admin.users.search')}
            className="w-full sm:w-72"
          />
        </div>

        {others.length === 0 ? (
          <EmptyState compact icon={<SearchIcon size={20} />} title={t('admin.users.noMatches', { query })} />
        ) : (
          <>
            <table className="hidden w-full text-left md:table">
              <thead>
                <tr className="border-y border-line bg-inset/60 text-xs font-medium text-muted">
                  <th scope="col" className="py-2 pr-3 pl-6 font-medium">{t('admin.users.col.user')}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t('admin.users.col.status')}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t('admin.users.col.role')}</th>
                  {has2fa && <th scope="col" className="px-3 py-2 font-medium">{t('admin.users.col.twoFactor')}</th>}
                  <th scope="col" className="px-3 py-2 text-right font-medium">{t('admin.users.col.quota')}</th>
                  <th scope="col" className="w-14 py-2 pr-4 pl-3">
                    <span className="sr-only">{t('admin.users.col.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {others.map((u) => (
                  <tr key={u.id} className="transition-colors hover:bg-hover/60">
                    <td className="py-2.5 pr-3 pl-6">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={u.display_name || u.email} size={32} />
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 truncate text-base font-medium text-ink">
                            <span className="truncate">{u.display_name || u.email}</span>
                            {u.id === me.id && <Badge>{t('admin.users.you')}</Badge>}
                          </p>
                          <p className="truncate text-sm text-muted">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5"><StatusBadge status={u.status} /></td>
                    <td className="px-3 py-2.5">
                      {u.is_instance_admin ? (
                        <Badge tone="accent" icon={<AdminIcon size={10} />}>{t('admin.users.roleAdmin')}</Badge>
                      ) : (
                        <span className="text-sm text-muted">{t('admin.users.roleUser')}</span>
                      )}
                    </td>
                    {has2fa && <td className="px-3 py-2.5">{twoFa(u)}</td>}
                    <td className="px-3 py-2.5 text-right text-sm text-muted tabular-nums">{quota(u)}</td>
                    <td className="py-2.5 pr-4 pl-3 text-right">{actions(u)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="divide-y divide-line border-t border-line md:hidden">
              {others.map((u) => (
                <li key={u.id} className="flex items-start gap-3 px-4 py-3">
                  <Avatar name={u.display_name || u.email} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium text-ink">{u.display_name || u.email}</p>
                    <p className="truncate text-sm text-muted">{u.email}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={u.status} />
                      {u.is_instance_admin && (
                        <Badge tone="accent" icon={<AdminIcon size={10} />}>{t('admin.users.roleAdmin')}</Badge>
                      )}
                      {u.id === me.id && <Badge>{t('admin.users.you')}</Badge>}
                      {u.two_factor_enabled && (
                        <Badge tone="ok" icon={<ShieldIcon size={10} />}>2FA</Badge>
                      )}
                      <span className="text-xs text-muted">{quota(u)}</span>
                    </div>
                  </div>
                  {actions(u)}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {quotaUser && <QuotaModal user={quotaUser} onClose={() => setQuotaUser(null)} onSaved={() => void refresh()} />}
      {dialog}
    </div>
  );
}
