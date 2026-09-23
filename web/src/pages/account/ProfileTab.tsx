import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../i18n';
import { useToast } from '../../components/Toast';
import { Button } from '../../components/ui/Button';
import { Avatar, Badge, Section } from '../../components/ui/Card';
import { Field, Input } from '../../components/ui/Input';
import { Notice } from '../../components/ui/Notice';
import { AdminIcon } from '../../components/icons';

export function ProfileTab() {
  const { t, formatDate } = useI18n();
  const { toast } = useToast();
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.display_name || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setName(user?.display_name || ''), [user?.display_name]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setUser(await api.updateProfile(name.trim()));
      toast({ message: t('account.profile.saved') });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('account.profile.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  const display = user?.display_name || user?.email || '?';

  return (
    <div className="space-y-6">
      <div className="panel flex flex-wrap items-center gap-4 px-5 py-5 sm:px-6">
        <Avatar name={display} size={56} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold text-ink">{display}</p>
          <p className="truncate text-sm text-muted">{user?.email}</p>
          {user?.created_at && (
            <p className="mt-0.5 text-xs text-faint">{t('account.profile.memberSince', { date: formatDate(user.created_at) })}</p>
          )}
        </div>
        {user?.is_instance_admin && (
          <Badge tone="accent" icon={<AdminIcon size={11} />}>
            {t('account.profile.adminBadge')}
          </Badge>
        )}
      </div>

      <form onSubmit={submit}>
        <Section
          title={t('account.profile.title')}
          description={t('account.profile.description')}
          footer={
            <Button type="submit" variant="primary" loading={busy} disabled={!name.trim() || name.trim() === user?.display_name}>
              {t('common.save')}
            </Button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('account.profile.displayName')}>
              {({ id }) => (
                <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} />
              )}
            </Field>
            <Field label={t('account.profile.email')} hint={t('account.profile.emailHint')}>
              {({ id, describedBy }) => (
                <Input id={id} value={user?.email || ''} readOnly disabled aria-describedby={describedBy} />
              )}
            </Field>
          </div>
          {error && <Notice kind="error" className="mt-4">{error}</Notice>}
        </Section>
      </form>

      {user?.is_instance_admin && (
        <Notice kind="warning" title={t('account.profile.adminTitle')}>
          {t('account.profile.adminHint')}{' '}
          <Link to="/admin" className="font-medium underline underline-offset-2">
            {t('account.profile.openAdmin')}
          </Link>
        </Notice>
      )}
    </div>
  );
}
