import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArkiveLogo } from '../components/ArkiveLogo';
import { api } from '../lib/api';

export function PublicSharePage() {
  const { token = '' } = useParams();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  async function load(pass?: string) {
    setError('');
    try {
      const meta = await api.publicMeta(token, pass);
      setName(meta.name);
      setKind(meta.kind);
      setNeedsPassword(false);
      setReady(true);
    } catch (err) {
      const e = err as Error & { status?: number; data?: { needs_password?: boolean } };
      if (e.status === 401 || e.data?.needs_password) {
        setNeedsPassword(true);
        setReady(false);
        if (pass) setError('Incorrect password');
        return;
      }
      setError(e.message || 'Link unavailable');
      setReady(false);
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  function onUnlock(e: FormEvent) {
    e.preventDefault();
    void load(password);
  }

  const downloadHref = password
    ? `/api/public/${token}/download?password=${encodeURIComponent(password)}`
    : `/api/public/${token}/download`;

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md rounded-2xl border border-arkive-border bg-arkive-surface/90 p-6 text-center"
      >
        <div className="mb-4 flex justify-center">
          <ArkiveLogo size={64} />
        </div>
        <h1 className="font-display text-2xl font-bold">Shared from Arkive</h1>

        {error && !needsPassword && (
          <p className="mt-4 text-sm text-red-300">{error}</p>
        )}

        {needsPassword && (
          <form onSubmit={onUnlock} className="mt-5 space-y-3 text-left">
            <p className="text-sm text-arkive-muted">This link is password protected.</p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full rounded-lg border border-arkive-border bg-arkive-bg px-3 py-2.5 outline-none focus:ring-2 focus:ring-arkive-amber/40"
            />
            {error && <p className="text-sm text-red-300">{error}</p>}
            <button
              type="submit"
              className="w-full rounded-lg bg-gradient-to-r from-arkive-orange to-arkive-amber px-4 py-2.5 font-semibold text-black"
            >
              Unlock
            </button>
          </form>
        )}

        {ready && (
          <div className="mt-5">
            <p className="font-medium">{name}</p>
            <p className="mt-1 text-sm text-arkive-muted capitalize">{kind}</p>
            {kind === 'file' ? (
              <a
                href={downloadHref}
                className="mt-5 inline-flex rounded-lg bg-gradient-to-r from-arkive-orange to-arkive-amber px-4 py-2.5 text-sm font-semibold text-black"
              >
                Download
              </a>
            ) : (
              <p className="mt-4 text-sm text-arkive-muted">
                Folder public browsing is not enabled — ask for a file link.
              </p>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
