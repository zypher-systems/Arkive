import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../i18n';
import { useToast } from '../../components/Toast';
import { Button } from '../../components/ui/Button';
import { Section } from '../../components/ui/Card';
import { Field, Input } from '../../components/ui/Input';
import { Notice } from '../../components/ui/Notice';
import { TwoFactorCard } from './TwoFactor';

export function SecurityTab() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user, setUser } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8 || password !== confirm) return;
    setBusy(true);
    setError('');
    try {
      setUser(await api.updateProfile(user?.display_name || '', password));
      setPassword('');
      setConfirm('');
      toast({ message: t('account.security.passwordChanged') });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('account.security.passwordFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit}>
        <Section
          title={t('account.security.passwordTitle')}
          description={t('account.security.passwordDescription')}
          footer={
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={password.length < 8 || password !== confirm}
            >
              {t('account.security.updatePassword')}
            </Button>
          }
        >
          {/* Hidden username helps password managers pair the new password with the account. */}
          <input type="text" name="username" autoComplete="username" value={user?.email || ''} readOnly hidden />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('account.security.newPassword')}
              hint={t('account.security.passwordRule')}
              error={tooShort ? t('account.security.passwordRule') : undefined}
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('account.security.confirmPassword')} error={mismatch ? t('account.security.mismatch') : undefined}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              )}
            </Field>
          </div>
          <p className="mt-4 text-sm text-muted">{t('account.security.forgotHint')}</p>
          {error && <Notice kind="error" className="mt-4">{error}</Notice>}
        </Section>
      </form>

      <TwoFactorCard />
    </div>
  );
}
