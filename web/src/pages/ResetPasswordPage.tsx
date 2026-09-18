import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LockIcon, SpinnerIcon } from '../components/icons';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Notice } from '../components/ui/Notice';
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
      <div className="animate-fade-up w-full max-w-[400px]">
        <div className="mb-6 flex flex-col items-center text-center">
          <ArkiveLogo size={40} className="text-primary" />
          <h1 className="mt-4 text-[22px] font-semibold tracking-tight">Reset password</h1>
          <p className="mt-1.5 text-[13px] text-muted">Choose a new password for your Arkive account.</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="panel p-6 shadow-sm"
        >
          {!token && (
            <Notice kind="error" className="mb-4">
              This page needs a valid reset link from your email.
            </Notice>
          )}
          <div className="space-y-3">
            <Input
              required
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password"
              autoComplete="new-password"
              icon={<LockIcon size={14} />}
            />
            <Input
              required
              type="password"
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm password"
              autoComplete="new-password"
              icon={<LockIcon size={14} />}
            />
          </div>
          {error && <Notice kind="error" className="mt-4">{error}</Notice>}
          <Button
            type="submit"
            variant="primary"
            full
            disabled={busy || !token}
            className="mt-5"
            icon={busy ? <SpinnerIcon size={14} className="animate-spin" /> : undefined}
          >
            {busy ? 'Saving…' : 'Update password'}
          </Button>
          <p className="mt-4 text-center text-sm text-muted">
            <Link to="/login" className="text-accent-strong transition hover:underline">
              ← Back to sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
