import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { ArrowLeftIcon, KeyIcon, LockIcon, MailIcon, ShieldIcon, UserIcon } from '../components/icons';
import { Button, LinkButton } from '../components/ui/Button';
import { Field, Input } from '../components/ui/Input';
import { Notice } from '../components/ui/Notice';
import { api, ApiError, isTwoFactorChallenge, type User } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useInstance } from '../lib/instance';
import { useI18n } from '../i18n';

type Mode = 'login' | 'register' | 'forgot' | 'twofactor';

function safeNext(raw: string | null) {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

export function LoginPage() {
  const { t } = useI18n();
  const { user, setUser, loading } = useAuth();
  const { info } = useInstance();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [challenge, setChallenge] = useState('');
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState('');
  const [info2, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  const registrationOpen = info?.registration_open ?? true;
  const oidc = info?.oidc;

  useEffect(() => {
    const err = params.get('error');
    if (err === 'pending') setError(t('auth.errors.pending'));
    else if (err === 'rejected') setError(t('auth.errors.rejected'));
    else if (err === 'registration_closed') setError(t('auth.errors.registrationClosed'));
    else if (err === 'oidc_email_taken') setError(t('auth.errors.oidcEmailTaken'));
    else if (err) setError(t('auth.errors.sso', { code: err }));
    if (params.get('reset') === 'ok') {
      setInfo(t('auth.resetDone'));
      setMode('login');
    }
  }, [params, t]);

  useEffect(() => {
    if (mode === 'twofactor') window.setTimeout(() => codeRef.current?.focus(), 30);
  }, [mode, useRecovery]);

  if (!loading && user) return <Navigate to={next} replace />;

  function switchMode(m: Mode) {
    setMode(m);
    setError('');
    setInfo('');
  }

  function signedIn(u: User) {
    setUser(u);
    navigate(next, { replace: true });
  }

  function friendly(err: unknown) {
    const msg = err instanceof Error ? err.message : t('common.failed');
    if (msg === 'pending approval') return t('auth.errors.pending');
    if (msg === 'account rejected') return t('auth.errors.rejected');
    if (err instanceof ApiError && err.status === 429) return t('auth.errors.rateLimited');
    if (err instanceof ApiError && err.status === 401 && mode === 'login') return t('auth.errors.invalid');
    return msg;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'forgot') {
        const res = await api.forgotPassword(email);
        setInfo(res.message || t('auth.forgotSent'));
        return;
      }
      if (mode === 'login') {
        const res = await api.login(email, password);
        if (isTwoFactorChallenge(res)) {
          setChallenge(res.challenge);
          setCode('');
          setUseRecovery(false);
          setMode('twofactor');
          return;
        }
        signedIn(res);
        return;
      }
      if (mode === 'twofactor') {
        signedIn(await api.loginTwoFactor(challenge, code.trim()));
        return;
      }
      const result = await api.register(email, password, displayName);
      if ('message' in result && result.status === 'pending') {
        setInfo(result.message || t('auth.pendingInfo'));
        setMode('login');
        return;
      }
      signedIn(result as User);
    } catch (err) {
      if (mode === 'twofactor' && err instanceof ApiError && (err.status === 401 || err.status === 410)) {
        // Challenge expired (5 min TTL) or wrong code.
        setError(err.status === 410 || /expired|challenge/i.test(err.message) ? t('auth.twofa.expired') : t('auth.twofa.invalid'));
        if (err.status === 410) setMode('login');
      } else {
        setError(friendly(err));
      }
    } finally {
      setBusy(false);
    }
  }

  const titles: Record<Mode, { title: string; subtitle: string }> = {
    login: { title: t('auth.signInTitle'), subtitle: t('auth.signInSubtitle') },
    register: { title: t('auth.registerTitle'), subtitle: t('auth.registerSubtitle') },
    forgot: { title: t('auth.forgotTitle'), subtitle: t('auth.forgotSubtitle') },
    twofactor: {
      title: t('auth.twofa.title'),
      subtitle: useRecovery ? t('auth.twofa.recoverySubtitle') : t('auth.twofa.subtitle'),
    },
  };

  return (
    <AuthLayout
      title={titles[mode].title}
      subtitle={titles[mode].subtitle}
      footer={
        mode === 'login' && registrationOpen ? (
          <>
            {t('auth.noAccount')}{' '}
            <button type="button" className="font-medium text-accent-strong hover:underline" onClick={() => switchMode('register')}>
              {t('auth.createAccount')}
            </button>
          </>
        ) : mode === 'register' ? (
          <>
            {t('auth.haveAccount')}{' '}
            <button type="button" className="font-medium text-accent-strong hover:underline" onClick={() => switchMode('login')}>
              {t('auth.signIn')}
            </button>
          </>
        ) : undefined
      }
    >
      {mode === 'twofactor' && (
        <div className="mb-5 flex justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-strong">
            <ShieldIcon size={22} />
          </span>
        </div>
      )}
      <form onSubmit={onSubmit} className="space-y-4" noValidate={mode === 'twofactor'}>
        {mode === 'register' && (
          <Field label={t('auth.displayName')}>
            {({ id }) => (
              <Input
                id={id}
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
                icon={<UserIcon size={15} />}
              />
            )}
          </Field>
        )}
        {mode !== 'twofactor' && (
          <Field label={t('auth.email')}>
            {({ id }) => (
              <Input
                id={id}
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete={mode === 'register' ? 'email' : 'username'}
                icon={<MailIcon size={15} />}
                autoFocus
              />
            )}
          </Field>
        )}
        {(mode === 'login' || mode === 'register') && (
          <Field
            label={t('auth.password')}
            aside={
              mode === 'login' ? (
                <button type="button" onClick={() => switchMode('forgot')} className="text-sm text-accent-strong hover:underline">
                  {t('auth.forgotLink')}
                </button>
              ) : undefined
            }
            hint={mode === 'register' ? t('auth.passwordHint') : undefined}
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                required
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                aria-describedby={describedBy}
                icon={<LockIcon size={15} />}
              />
            )}
          </Field>
        )}
        {mode === 'twofactor' && (
          <Field label={useRecovery ? t('auth.twofa.recoveryLabel') : t('auth.twofa.codeLabel')}>
            {({ id }) =>
              useRecovery ? (
                <Input
                  id={id}
                  ref={codeRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="xxxx-xxxx"
                  className="font-mono tracking-wider"
                  icon={<KeyIcon size={15} />}
                />
              ) : (
                <input
                  id={id}
                  ref={codeRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="000000"
                  className="input-field h-14 text-center font-mono text-2xl tracking-[0.5em] placeholder:tracking-[0.5em]"
                />
              )
            }
          </Field>
        )}

        {error && <Notice kind="error">{error}</Notice>}
        {info2 && <Notice kind="info">{info2}</Notice>}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          full
          loading={busy}
          disabled={mode === 'twofactor' && (useRecovery ? code.trim().length < 6 : code.length !== 6)}
        >
          {mode === 'login'
            ? t('auth.signIn')
            : mode === 'register'
              ? t('auth.createAccount')
              : mode === 'forgot'
                ? t('auth.sendReset')
                : t('auth.twofa.verify')}
        </Button>

        {mode === 'twofactor' && (
          <div className="flex flex-col items-center gap-2 pt-1 text-sm">
            <button
              type="button"
              className="font-medium text-accent-strong hover:underline"
              onClick={() => {
                setUseRecovery((v) => !v);
                setCode('');
                setError('');
              }}
            >
              {useRecovery ? t('auth.twofa.useApp') : t('auth.twofa.useRecovery')}
            </button>
            <button type="button" className="text-muted hover:text-ink" onClick={() => switchMode('login')}>
              {t('auth.twofa.differentAccount')}
            </button>
          </div>
        )}
        {mode === 'forgot' && (
          <button
            type="button"
            onClick={() => switchMode('login')}
            className="mx-auto flex items-center gap-1.5 text-sm text-muted hover:text-ink"
          >
            <ArrowLeftIcon size={14} /> {t('auth.backToSignIn')}
          </button>
        )}
      </form>

      {oidc?.enabled && (mode === 'login' || mode === 'register') && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-faint">
            <div className="h-px flex-1 bg-line" />
            {t('auth.or')}
            <div className="h-px flex-1 bg-line" />
          </div>
          <LinkButton href="/api/auth/oidc/start" variant="secondary" size="lg" className="w-full">
            {t('auth.continueWith', { provider: oidc.provider_name || 'SSO' })}
          </LinkButton>
        </>
      )}
      {mode === 'login' && !registrationOpen && <p className="mt-5 text-center text-sm text-muted">{t('auth.inviteOnly')}</p>}
    </AuthLayout>
  );
}
