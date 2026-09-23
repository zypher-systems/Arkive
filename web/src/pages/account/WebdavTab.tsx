import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type Workspace } from '../../lib/api';
import { copyText } from '../../lib/hooks';
import { useConfirm } from '../../lib/confirm';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../i18n';
import { useToast } from '../../components/Toast';
import { Button, IconButton } from '../../components/ui/Button';
import { EmptyState, Section } from '../../components/ui/Card';
import { Field, Input } from '../../components/ui/Input';
import { Notice } from '../../components/ui/Notice';
import { Spinner } from '../../components/ui/Spinner';
import { CheckIcon, CopyIcon, KeyIcon, TrashIcon } from '../../components/icons';

type AppPassword = { id: string; name: string; prefix: string; created_at: string; last_used_at?: string | null };

function davURL(id: string) {
  return `${window.location.origin}/dav/${id}/`;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <IconButton
      label={done ? t('common.copied') : label}
      size="md"
      onClick={() =>
        void copyText(value).then((ok) => {
          if (!ok) return;
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? <CheckIcon size={15} className="text-ok" /> : <CopyIcon size={15} />}
    </IconButton>
  );
}

export function WebdavTab() {
  const { t, formatDateTime, formatRelative } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();
  const { ask, dialog } = useConfirm();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [passwords, setPasswords] = useState<AppPassword[] | null>(null);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadPasswords = useCallback(async () => {
    setPasswords(await api.listAppPasswords());
  }, []);

  useEffect(() => {
    api.workspaces().then(setWorkspaces).catch(() => setWorkspaces([]));
    void loadPasswords().catch(() => setPasswords([]));
  }, [loadPasswords]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const created = await api.createAppPassword(name.trim() || 'WebDAV');
      setSecret(created.secret);
      setName('');
      await loadPasswords();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('account.webdav.createFailed'));
    } finally {
      setBusy(false);
    }
  }

  function revoke(p: AppPassword) {
    ask({
      title: t('account.webdav.revokeTitle'),
      message: t('account.webdav.revokeMessage', { name: p.name }),
      confirmLabel: t('account.webdav.revoke'),
      run: async () => {
        try {
          await api.revokeAppPassword(p.id);
          if (secret.includes(p.prefix)) setSecret('');
          await loadPasswords();
          toast({ message: t('account.webdav.revoked', { name: p.name }) });
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          throw err;
        }
      },
    });
  }

  const label = (w: Workspace) => (w.type === 'personal' ? t('nav.myFiles') : w.name || t('nav.cloud'));

  return (
    <div className="space-y-6">
      <Section title={t('account.webdav.mountTitle')} description={t('account.webdav.mountDescription')}>
        <dl className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-inset/70 px-3.5 py-2.5 text-sm">
          <dt className="text-muted">{t('account.webdav.username')}</dt>
          <dd className="min-w-0 truncate font-mono text-ink">{user?.email}</dd>
          <dd className="ml-auto">
            <CopyButton value={user?.email || ''} label={t('account.webdav.copyUsername')} />
          </dd>
        </dl>
        {workspaces === null ? (
          <div className="flex justify-center py-3">
            <Spinner className="text-faint" />
          </div>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {workspaces.map((w) => (
              <li key={w.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium text-ink">{label(w)}</p>
                  <code className="block truncate font-mono text-xs text-muted" title={davURL(w.id)}>
                    {davURL(w.id)}
                  </code>
                </div>
                <CopyButton value={davURL(w.id)} label={t('account.webdav.copyUrl', { name: label(w) })} />
              </li>
            ))}
            {workspaces.length === 0 && <li className="px-3.5 py-3 text-sm text-muted">{t('account.webdav.noWorkspaces')}</li>}
          </ul>
        )}
      </Section>

      <Section title={t('account.webdav.appTitle')} description={t('account.webdav.appDescription')}>
        <form onSubmit={create} className="flex flex-wrap items-end gap-2">
          <Field label={t('account.webdav.appName')} className="min-w-0 flex-1">
            {({ id }) => (
              <Input
                id={id}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('account.webdav.appNamePlaceholder')}
                maxLength={80}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" loading={busy} icon={<KeyIcon size={15} />}>
            {t('account.webdav.create')}
          </Button>
        </form>

        {secret && (
          <div className="animate-fade-in mt-4 rounded-lg border border-accent-line bg-accent-soft p-4">
            <p className="text-sm font-medium text-accent-strong">{t('account.webdav.secretOnce')}</p>
            <div className="mt-2 flex items-center gap-2 rounded-md bg-surface px-3 py-2 ring-1 ring-line">
              <code className="min-w-0 flex-1 font-mono text-sm break-all text-ink">{secret}</code>
              <CopyButton value={secret} label={t('account.webdav.copySecret')} />
            </div>
          </div>
        )}
        {error && <Notice kind="error" className="mt-4">{error}</Notice>}

        <div className="mt-5">
          {passwords === null ? (
            <div className="flex justify-center py-3">
              <Spinner className="text-faint" />
            </div>
          ) : passwords.length === 0 ? (
            <EmptyState compact icon={<KeyIcon size={20} />} title={t('account.webdav.noneTitle')} hint={t('account.webdav.noneHint')} />
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {passwords.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-3.5 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-inset text-muted ring-1 ring-line">
                    <KeyIcon size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium text-ink">{p.name}</p>
                    <p className="truncate text-sm text-muted">
                      <span className="font-mono">ark_{p.prefix}_…</span> ·{' '}
                      <span title={formatDateTime(p.created_at)}>{t('account.webdav.created', { when: formatRelative(p.created_at) })}</span> ·{' '}
                      {p.last_used_at ? (
                        <span title={formatDateTime(p.last_used_at)}>{t('account.webdav.lastUsed', { when: formatRelative(p.last_used_at) })}</span>
                      ) : (
                        t('account.webdav.neverUsed')
                      )}
                    </p>
                  </div>
                  <IconButton
                    label={t('account.webdav.revokeName', { name: p.name })}
                    size="md"
                    className="hover:!bg-danger-soft hover:!text-danger"
                    onClick={() => revoke(p)}
                  >
                    <TrashIcon size={15} />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>
      {dialog}
    </div>
  );
}
