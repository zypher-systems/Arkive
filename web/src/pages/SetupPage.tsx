import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { KeyIcon, LockIcon, MailIcon, UserIcon } from '../components/icons';
import { Button } from '../components/ui/Button';
import { Field, Input } from '../components/ui/Input';
import { Notice } from '../components/ui/Notice';
import { api, ApiError, isMissingEndpoint } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useInstance } from '../lib/instance';
import { useI18n } from '../i18n';

/** First-run setup (contract §6): create the first instance admin. */
export function SetupPage() {
  const { t } = useI18n();
  const { info, loading, refresh } = useInstance();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [token, setToken] = useState('');
  const [tokenRequired, setTokenRequired] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .setupStatus()
      .then((s) => setTokenRequired(s.token_required !== false))
      .catch(() => undefined);
    // Pre-fill from ?token= so operators can paste a full link.
    const q = new URLSearchParams(window.location.search).get('token');
    if (q) setToken(q);
  }, []);

  if (!loading && !info?.setup_needed) return <Navigate to="/login" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError(t('setup.errors.passwordShort'));
    if (password !== confirm) return setError(t('setup.errors.mismatch'));
    setBusy(true);
    try {
      const user = await api.setup({
        email: email.trim(),
        password,
        display_name: name.trim(),
        ...(token.trim() ? { setup_token: token.trim() } : {}),
      });
      setUser(user);
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        await refresh();
        setError(t('setup.errors.alreadyDone'));
      } else if (err instanceof ApiError && err.status === 403) {
        setError(t('setup.errors.badToken'));
      } else if (isMissingEndpoint(err)) {
        setError(t('setup.errors.unsupported'));
      } else {
        setError(err instanceof Error ? err.message : t('common.failed'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={t('setup.title')} subtitle={t('setup.subtitle')} width="max-w-[460px]">
      <ol className="mb-6 grid grid-cols-3 gap-2 text-center text-xs" aria-label={t('setup.stepsLabel')}>
        {[t('setup.step1'), t('setup.step2'), t('setup.step3')].map((s, i) => (
          <li key={s} className="flex flex-col items-center gap-1.5">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                i === 0 ? 'bg-accent text-accent-fg' : 'bg-active text-muted'
              }`}
            >
              {i + 1}
            </span>
            <span className={i === 0 ? 'font-medium text-ink' : 'text-muted'}>{s}</span>
          </li>
        ))}
      </ol>
      <form onSubmit={onSubmit} className="space-y-4">
        {tokenRequired && (
          <Field label={t('setup.token')} hint={t('setup.tokenHint')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                aria-describedby={describedBy}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                icon={<KeyIcon size={15} />}
              />
            )}
          </Field>
        )}
        <Field label={t('auth.displayName')}>
          {({ id }) => (
            <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" icon={<UserIcon size={15} />} />
          )}
        </Field>
        <Field label={t('auth.email')}>
          {({ id }) => (
            <Input
              id={id}
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              icon={<MailIcon size={15} />}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('auth.password')}>
            {({ id }) => (
              <Input
                id={id}
                required
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
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
        </div>
        <p className="text-xs text-muted">{t('setup.adminNote')}</p>
        {error && <Notice kind="error">{error}</Notice>}
        <Button type="submit" variant="accent" size="lg" full loading={busy}>
          {t('setup.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
