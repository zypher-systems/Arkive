import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
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
          <ArkiveLogo size={72} />
          <h1 className="mt-4 font-display text-3xl font-bold">Reset password</h1>
          <p className="mt-2 text-sm text-arkive-muted">Choose a new password for your Arkive account.</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-arkive-border bg-arkive-surface/90 p-6"
        >
          {!token && (
            <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              This page needs a valid reset link from your email.
            </p>
          )}
          <label className="mb-3 block text-sm">
            <span className="mb-1.5 block text-arkive-muted">New password</span>
            <input
              required
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2.5 outline-none focus:ring-2 focus:ring-arkive-amber/40"
            />
          </label>
          <label className="mb-5 block text-sm">
            <span className="mb-1.5 block text-arkive-muted">Confirm password</span>
            <input
              required
              type="password"
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2.5 outline-none focus:ring-2 focus:ring-arkive-amber/40"
            />
          </label>
          {error && (
            <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !token}
            className="w-full cursor-pointer rounded-lg bg-gradient-to-r from-arkive-orange to-arkive-amber px-4 py-2.5 font-semibold text-black disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Update password'}
          </button>
          <p className="mt-4 text-center text-sm text-arkive-muted">
            <Link to="/login" className="text-arkive-amber hover:underline">
              Back to sign in
            </Link>
          </p>
        </form>
      </motion.div>
    </div>
  );
}
