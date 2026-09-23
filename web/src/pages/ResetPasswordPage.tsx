import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { ArrowLeftIcon, LockIcon } from '../components/icons';
import { Button } from '../components/ui/Button';
import { Field, Input } from '../components/ui/Input';
import { Notice } from '../components/ui/Notice';
import { api } from '../lib/api';
import { useI18n } from '../i18n';

export function ResetPasswordPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!token) return setError(t('reset.missingToken'));
    if (password.length < 8) return setError(t('setup.errors.passwordShort'));
    if (password !== confirm) return setError(t('setup.errors.mismatch'));
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      navigate('/login?reset=ok', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reset.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title={t('reset.title')}
      subtitle={t('reset.subtitle')}
      footer={
        <Link to="/login" className="inline-flex items-center gap-1.5 text-muted hover:text-ink">
          <ArrowLeftIcon size={14} /> {t('auth.backToSignIn')}
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {!token && <Notice kind="error">{t('reset.missingToken')}</Notice>}
        <Field label={t('reset.newPassword')} hint={t('auth.passwordHint')}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              required
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              aria-describedby={describedBy}
              icon={<LockIcon size={15} />}
            />
          )}
        </Field>
        <Field label={t('setup.confirm')}>
          {({ id }) => (
            <Input
              id={id}
              required
              type="password"
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              icon={<LockIcon size={15} />}
            />
          )}
        </Field>
        {error && <Notice kind="error">{error}</Notice>}
        <Button type="submit" variant="primary" size="lg" full loading={busy} disabled={!token}>
          {t('reset.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
