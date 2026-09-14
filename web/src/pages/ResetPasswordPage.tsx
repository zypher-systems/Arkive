import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertCircle, Loader2, Lock, LockKeyhole } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { ArkiveLogo } from '../components/ArkiveLogo';
import { api } from '../lib/api';

export function ResetPasswordPage() {
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
    if (!token) {
      setError('Missing reset token. Use the link from your email.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      navigate('/login?reset=ok', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <ArkiveLogo size={76} />
          <h1 className="mt-5 font-display text-3xl font-bold tracking-tight">Reset password</h1>
          <p className="mt-2 text-sm text-arkive-muted">Choose a new password for your Arkive account.</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="glass-strong glass-hairline rounded-3xl p-6 shadow-[0_24px_80px_rgba(3,4,12,0.6)]"
        >
          {!token && (
            <p className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
              <AlertCircle size={16} className="shrink-0" />
              This page needs a valid reset link from your email.
            </p>
          )}
          <div className="space-y-3.5">
            <Input
              required
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password"
              autoComplete="new-password"
              icon={<Lock size={16} />}
            />
            <Input
              required
              type="password"
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm password"
              autoComplete="new-password"
              icon={<LockKeyhole size={16} />}
            />
          </div>
          {error && (
            <p className="mt-4 flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
              <AlertCircle size={16} className="shrink-0" />
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            full
            disabled={busy || !token}
            className="mt-5 font-semibold"
            icon={busy ? <Loader2 size={16} className="animate-spin" /> : undefined}
          >
            {busy ? 'Saving…' : 'Update password'}
          </Button>
          <p className="mt-4 text-center text-sm text-arkive-muted">
            <Link to="/login" className="text-arkive-accent2 transition hover:text-cyan-200 hover:underline">
              ← Back to sign in
            </Link>
          </p>
        </form>
      </motion.div>
    </div>
  );
}
