import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { LockIcon, MailIcon, SpinnerIcon, UserIcon } from '../components/icons';
import { ArkiveLogo } from '../components/ArkiveLogo';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Segmented } from '../components/ui/Segmented';
import { Notice } from '../components/ui/Notice';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const { user, setUser, loading } = useAuth();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [oidc, setOidc] = useState<{ enabled: boolean; provider_name: string } | null>(null);
  const [registrationOpen, setRegistrationOpen] = useState(true);

  useEffect(() => {
    void api.oidcEnabled().then(setOidc).catch(() => setOidc({ enabled: false, provider_name: 'SSO' }));
    void api.registrationOpen().then((r) => setRegistrationOpen(r.open)).catch(() => setRegistrationOpen(true));
    const err = params.get('error');
    if (err === 'pending') setError('Your account is pending admin approval.');
    else if (err === 'rejected') setError('Your account was rejected by an admin.');
    else if (err === 'registration_closed') setError('Registration is closed on this instance.');
    else if (err === 'oidc_email_taken') setError('That email is already registered. Sign in with your password.');
    else if (err) setError(`SSO sign-in failed (${err})`);
    if (params.get('reset') === 'ok') {
      setInfo('Password updated. Sign in with your new password.');
      setMode('login');
    }
  }, [params]);

  if (!loading && user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'forgot') {
        const res = await api.forgotPassword(email);
        setInfo(res.message || 'If an account exists, a reset link will be sent when mail is configured.');
        return;
      }
      if (mode === 'login') {
        setUser(await api.login(email, password));
        return;
      }
      const result = await api.register(email, password, displayName);
      if ('message' in result && result.status === 'pending') {
        setInfo(result.message || 'Account pending admin approval');
        setMode('login');
        return;
      }
      setUser(result as Awaited<ReturnType<typeof api.login>>);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      if (msg === 'pending approval') {
        setError('Your account is pending admin approval.');
      } else if (msg === 'account rejected') {
        setError('Your account was rejected by an admin.');
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="animate-fade-up w-full max-w-[400px]">
        <div className="mb-7 flex flex-col items-center text-center">
          <ArkiveLogo size={44} className="text-primary" />
          <h1 className="mt-4 text-[22px] font-semibold tracking-tight text-ink">Arkive</h1>
          <p className="mt-1.5 max-w-sm text-[13px] text-muted">
            Your private vault in the cloud — new accounts need admin approval before signing in.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="panel p-6 shadow-sm"
        >
          {mode !== 'forgot' && (
            <div className="mb-5 flex justify-center">
              <Segmented
                value={mode}
                onChange={(v) => {
                  setMode(v);
                  setError('');
                  setInfo('');
                }}
                items={[
                  { value: 'login', label: 'Sign in' },
                  ...(registrationOpen
                    ? [{ value: 'register' as const, label: 'Create account' }]
                    : []),
                ]}
              />
            </div>
          )}

          {mode === 'forgot' && (
            <div className="mb-5 text-center">
              <h2 className="text-[15px] font-semibold">Forgot password</h2>
              <p className="mt-1 text-[13px] text-muted">
                Enter your email and we’ll send a reset link if SMTP is configured on this instance.
              </p>
            </div>
          )}

          <div className="space-y-3">
            {mode === 'register' && (
              <Input
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Display name"
                icon={<UserIcon size={14} />}
              />
            )}
            <Input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              autoComplete="email"
              icon={<MailIcon size={14} />}
            />
            {mode !== 'forgot' && (
              <Input
                required
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                icon={<LockIcon size={14} />}
              />
            )}
          </div>

          {error && <Notice kind="error" className="mt-4">{error}</Notice>}
          {info && <Notice kind="info" className="mt-4">{info}</Notice>}

          <Button
            type="submit"
            variant="primary"
            full
            disabled={busy}
            className="mt-5"
            icon={busy ? <SpinnerIcon size={14} className="animate-spin" /> : undefined}
          >
            {busy
              ? 'Working…'
              : mode === 'login'
                ? 'Sign in'
                : mode === 'forgot'
                  ? 'Send reset link'
                  : 'Create account'}
          </Button>

          {mode === 'login' && (
            <button
              type="button"
              onClick={() => {
                setMode('forgot');
                setError('');
                setInfo('');
              }}
              className="mt-4 w-full cursor-pointer text-center text-[13px] text-muted transition hover:text-accent-strong"
            >
              Forgot password?
            </button>
          )}
          {mode === 'forgot' && (
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
                setInfo('');
              }}
              className="mt-4 w-full cursor-pointer text-center text-[13px] text-muted transition hover:text-accent-strong"
            >
              ← Back to sign in
            </button>
          )}

          {oidc?.enabled && mode !== 'forgot' && (
            <>
              <div className="my-5 flex items-center gap-3 text-xs text-faint">
                <div className="h-px flex-1 bg-line" />
                or
                <div className="h-px flex-1 bg-line" />
              </div>
              <a
                href="/api/auth/oidc/start"
                className="flex w-full items-center justify-center gap-2 rounded-md border border-strong bg-surface px-5 py-2 text-sm font-medium text-ink transition hover:bg-hover"
              >
                Continue with {oidc.provider_name}
              </a>
            </>
          )}
        </form>

        <p className="mt-6 text-center text-xs text-faint">
          Arkive — self-hosted, private by design.
        </p>
      </div>
    </div>
  );
}
