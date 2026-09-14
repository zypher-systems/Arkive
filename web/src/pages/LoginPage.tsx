import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Info, Loader2, Lock, Mail, UserRound } from 'lucide-react';
import { ArkiveLogo, ArkiveWordmark } from '../components/ArkiveLogo';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Segmented } from '../components/ui/Segmented';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const ease = [0.22, 1, 0.36, 1] as const;

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
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-10">
      {/* Hero aurora blobs */}
      <div
        className="aurora-blob animate-aurora-c left-1/2 top-[-30vh] h-[70vh] w-[70vh] -translate-x-1/2 bg-[radial-gradient(circle,rgba(139,92,246,0.28),transparent_65%)]"
        aria-hidden
      />
      <div
        className="aurora-blob animate-aurora-b bottom-[-25vh] left-[-15vw] h-[55vh] w-[55vh] bg-[radial-gradient(circle,rgba(34,211,238,0.16),transparent_65%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse at center, black 15%, transparent 72%)',
        }}
        aria-hidden
      />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease }}
        className="relative w-full max-w-md"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.5, ease }}
          >
            <ArkiveLogo size={92} />
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.45, ease }}
            className="mt-6 font-display text-5xl font-bold tracking-tight text-arkive-text"
          >
            Ark<span className="text-iridescent">ive</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.28, duration: 0.5 }}
            className="mt-2.5 max-w-sm text-sm text-arkive-muted"
          >
            Your private vault in the cloud — new accounts need admin approval before signing in.
          </motion.p>
        </div>

        <motion.form
          onSubmit={onSubmit}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22, duration: 0.5, ease }}
          className="glass-strong glass-hairline sheen-border relative rounded-3xl p-6 shadow-[0_24px_80px_rgba(3,4,12,0.6)]"
        >
          {mode !== 'forgot' && (
            <div className="mb-6 flex justify-center">
              <Segmented
                layoutId="login-mode"
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
            <div className="mb-6 text-center">
              <h2 className="font-display text-lg font-semibold">Forgot password</h2>
              <p className="mt-1 text-sm text-arkive-muted">
                Enter your email and we’ll send a reset link if SMTP is configured on this instance.
              </p>
            </div>
          )}

          <div className="space-y-3.5">
            {mode === 'register' && (
              <Input
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Display name"
                icon={<UserRound size={16} />}
              />
            )}
            <Input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              autoComplete="email"
              icon={<Mail size={16} />}
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
                icon={<Lock size={16} />}
              />
            )}
          </div>

          <AnimatePresence mode="popLayout">
            {error && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 flex items-start gap-2 overflow-hidden rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-sm text-red-300"
              >
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                {error}
              </motion.p>
            )}
            {info && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 flex items-start gap-2 overflow-hidden rounded-xl border border-arkive-accent2/25 bg-arkive-accent2/10 px-3 py-2.5 text-sm text-cyan-200"
              >
                <Info size={16} className="mt-0.5 shrink-0" />
                {info}
              </motion.p>
            )}
          </AnimatePresence>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            full
            disabled={busy}
            className="mt-5 font-semibold"
            icon={busy ? <Loader2 size={16} className="animate-spin" /> : undefined}
          >
            {busy
              ? 'Working…'
              : mode === 'login'
                ? 'Enter vault'
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
              className="mt-4 w-full cursor-pointer text-center text-sm text-arkive-muted transition hover:text-arkive-accent2"
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
              className="mt-4 w-full cursor-pointer text-center text-sm text-arkive-muted transition hover:text-arkive-accent2"
            >
              ← Back to sign in
            </button>
          )}

          {oidc?.enabled && mode !== 'forgot' && (
            <>
              <div className="my-5 flex items-center gap-3 text-xs text-arkive-muted">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent to-white/12" />
                or
                <div className="h-px flex-1 bg-gradient-to-l from-transparent to-white/12" />
              </div>
              <a
                href="/api/auth/oidc/start"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/8 bg-white/[0.04] px-5 py-2.5 text-sm font-medium text-arkive-text backdrop-blur-md transition-all duration-200 hover:border-white/16 hover:bg-white/[0.08] hover:shadow-[0_8px_28px_rgba(3,4,12,0.5)]"
              >
                Continue with {oidc.provider_name}
              </a>
            </>
          )}
        </motion.form>

        <p className="mt-6 text-center text-xs text-arkive-muted/70">
          <ArkiveWordmark className="text-xs" /> — self-hosted, private by design.
        </p>
      </motion.div>
    </div>
  );
}
