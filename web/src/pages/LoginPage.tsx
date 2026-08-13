import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArkiveLogo } from '../components/ArkiveLogo';
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
    <div className="relative flex min-h-full items-center justify-center px-4 py-10">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(rgba(38,42,54,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(38,42,54,0.5) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse at center, black 20%, transparent 75%)',
        }}
      />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.4 }}
          >
            <ArkiveLogo size={88} />
          </motion.div>
          <h1 className="mt-5 font-display text-5xl font-extrabold tracking-tight text-arkive-text">
            Arkive
          </h1>
          <p className="mt-2 max-w-sm text-arkive-muted">
            Private vault — new accounts need admin approval before they can sign in.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-arkive-border bg-arkive-surface/90 p-6 shadow-[0_0_0_1px_rgba(255,85,0,0.04)] backdrop-blur"
        >
          {mode !== 'forgot' && (
            <div className="mb-5 flex gap-2 rounded-lg bg-arkive-panel p-1">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                  setInfo('');
                }}
                className={`flex-1 cursor-pointer rounded-md px-3 py-2 text-sm font-medium capitalize transition ${
                  mode === 'login'
                    ? 'bg-gradient-to-r from-arkive-orange to-arkive-amber text-black'
                    : 'text-arkive-muted hover:text-arkive-text'
                }`}
              >
                login
              </button>
              {registrationOpen && (
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError('');
                    setInfo('');
                  }}
                  className={`flex-1 cursor-pointer rounded-md px-3 py-2 text-sm font-medium capitalize transition ${
                    mode === 'register'
                      ? 'bg-gradient-to-r from-arkive-orange to-arkive-amber text-black'
                      : 'text-arkive-muted hover:text-arkive-text'
                  }`}
                >
                  register
                </button>
              )}
            </div>
          )}

          {mode === 'forgot' && (
            <div className="mb-5">
              <h2 className="font-display text-lg font-semibold">Forgot password</h2>
              <p className="mt-1 text-sm text-arkive-muted">
                Enter your email and we’ll send a reset link if SMTP is configured on this instance.
              </p>
            </div>
          )}

          {mode === 'register' && (
            <label className="mb-3 block text-sm">
              <span className="mb-1.5 block text-arkive-muted">Display name</span>
              <input
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2.5 outline-none ring-arkive-amber/40 focus:ring-2"
              />
            </label>
          )}
          <label className="mb-3 block text-sm">
            <span className="mb-1.5 block text-arkive-muted">Email</span>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2.5 outline-none ring-arkive-amber/40 focus:ring-2"
            />
          </label>
          {mode !== 'forgot' && (
            <label className="mb-5 block text-sm">
              <span className="mb-1.5 block text-arkive-muted">Password</span>
              <input
                required
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2.5 outline-none ring-arkive-amber/40 focus:ring-2"
              />
            </label>
          )}
          {mode === 'forgot' && <div className="mb-5" />}

          {error && (
            <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}
          {info && (
            <p className="mb-4 rounded-lg border border-arkive-amber/30 bg-arkive-amber/10 px-3 py-2 text-sm text-arkive-amber">
              {info}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full cursor-pointer rounded-lg bg-gradient-to-r from-arkive-orange via-arkive-amber to-arkive-glow px-4 py-2.5 font-semibold text-black transition hover:brightness-110 disabled:opacity-60"
          >
            {busy
              ? 'Working…'
              : mode === 'login'
                ? 'Enter vault'
                : mode === 'forgot'
                  ? 'Send reset link'
                  : 'Create account'}
          </button>

          {mode === 'login' && (
            <button
              type="button"
              onClick={() => {
                setMode('forgot');
                setError('');
                setInfo('');
              }}
              className="mt-3 w-full cursor-pointer text-center text-sm text-arkive-muted hover:text-arkive-amber"
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
              className="mt-3 w-full cursor-pointer text-center text-sm text-arkive-muted hover:text-arkive-amber"
            >
              Back to sign in
            </button>
          )}

          {oidc?.enabled && mode !== 'forgot' && (
            <>
              <div className="my-4 flex items-center gap-3 text-xs text-arkive-muted">
                <div className="h-px flex-1 bg-arkive-border" />
                or
                <div className="h-px flex-1 bg-arkive-border" />
              </div>
              <a
                href="/api/auth/oidc/start"
                className="flex w-full items-center justify-center rounded-lg border border-arkive-border px-4 py-2.5 text-sm font-medium transition hover:border-arkive-amber/50"
              >
                Continue with {oidc.provider_name}
              </a>
            </>
          )}
        </form>
      </motion.div>
    </div>
  );
}
