import { useEffect, useState, type CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';

type Workspace = {
  id: string;
  name: string;
  type: string;
};

type MountDialog = {
  workspace: Workspace;
  mountPath: string;
  davUser: string;
  davPass: string;
};

const ORIGIN_KEY = 'arkive.desktop.origin';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function App() {
  const [origin, setOrigin] = useState(
    () => localStorage.getItem(ORIGIN_KEY) || 'http://localhost:3080',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [authed, setAuthed] = useState(false);
  const [rcloneOk, setRcloneOk] = useState<boolean | null>(null);
  const [mounted, setMounted] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<MountDialog | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    localStorage.setItem(ORIGIN_KEY, origin.replace(/\/$/, ''));
  }, [origin]);

  useEffect(() => {
    if (!isTauri()) {
      setRcloneOk(false);
      return;
    }
    void invoke<boolean>('rclone_available')
      .then(setRcloneOk)
      .catch(() => setRcloneOk(false));
  }, []);

  async function login() {
    setError('');
    setMessage('');
    const base = origin.replace(/\/$/, '');
    try {
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Login failed');
      }
      const ws = await fetch(`${base}/api/workspaces`, { credentials: 'include' });
      if (!ws.ok) throw new Error('Could not list workspaces');
      setWorkspaces(await ws.json());
      setAuthed(true);
      setMessage('Signed in');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
      setAuthed(false);
    }
  }

  function davUrl(id: string) {
    return `${origin.replace(/\/$/, '')}/dav/${id}/`;
  }

  async function copyUrl(url: string) {
    await navigator.clipboard.writeText(url);
    setMessage('Copied WebDAV URL');
  }

  async function openMount(w: Workspace) {
    setError('');
    setMessage('');
    if (!isTauri()) {
      setError('Mount requires the Arkive desktop app (Tauri), not a plain browser tab.');
      return;
    }
    if (rcloneOk === false) {
      setError('rclone not found on PATH. Install from https://rclone.org/install/ then restart Arkive.');
      return;
    }
    try {
      const mountPath = await invoke<string>('default_mount_dir', {
        workspaceName: w.name || w.id,
      });
      setDialog({
        workspace: w,
        mountPath,
        davUser: email,
        davPass: '',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function confirmMount() {
    if (!dialog) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!dialog.davUser.trim() || !dialog.davPass) {
        throw new Error('WebDAV username and app password are required');
      }
      const path = await invoke<string>('rclone_mount', {
        url: davUrl(dialog.workspace.id),
        user: dialog.davUser.trim(),
        pass: dialog.davPass,
        mountPoint: dialog.mountPath,
      });
      setMounted((m) => ({ ...m, [dialog.workspace.id]: path }));
      setMessage(`Mounted at ${path}`);
      setDialog(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function unmount(workspaceId: string) {
    const path = mounted[workspaceId];
    if (!path) return;
    setBusy(true);
    setError('');
    try {
      await invoke('rclone_unmount', { mountPoint: path });
      setMounted((m) => {
        const next = { ...m };
        delete next[workspaceId];
        return next;
      });
      setMessage(`Unmounted ${path}`);
    } catch (e) {
      setError(typeof e === 'string' ? e : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 28, margin: '0 0 8px' }}>Arkive</h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Thin desktop helper — mount workspaces over WebDAV with rclone.
      </p>

      {rcloneOk === false && (
        <p
          style={{
            fontSize: 13,
            color: '#fcd34d',
            background: 'rgba(245,158,11,0.12)',
            border: '1px solid rgba(245,158,11,0.35)',
            borderRadius: 10,
            padding: '10px 12px',
          }}
        >
          rclone is not available. Install it and ensure it is on your PATH, then restart this app.
          See https://rclone.org/install/
        </p>
      )}
      {rcloneOk === true && (
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>rclone detected on PATH.</p>
      )}

      <label style={{ display: 'block', marginBottom: 12, fontSize: 14 }}>
        <span style={{ color: 'var(--muted)' }}>Instance URL</span>
        <input
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          style={inputStyle}
        />
      </label>

      {!authed ? (
        <>
          <label style={{ display: 'block', marginBottom: 12, fontSize: 14 }}>
            <span style={{ color: 'var(--muted)' }}>Email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: 'block', marginBottom: 12, fontSize: 14 }}>
            <span style={{ color: 'var(--muted)' }}>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
            />
          </label>
          <button type="button" onClick={() => void login()} style={btnStyle}>
            Sign in
          </button>
        </>
      ) : (
        <>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            Signed in as {email}. Prefer an{' '}
            <strong style={{ color: 'var(--text)' }}>app password</strong> from Account → WebDAV
            for mounts.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0' }}>
            {workspaces.map((w) => (
              <li
                key={w.id}
                style={{
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  borderRadius: 12,
                  padding: 12,
                  marginBottom: 8,
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {w.name}{' '}
                  <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>
                    {w.type}
                  </span>
                </div>
                <code style={{ fontSize: 12, color: 'var(--muted)' }}>{davUrl(w.id)}</code>
                {mounted[w.id] && (
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--amber)' }}>
                    Mounted at {mounted[w.id]}
                  </div>
                )}
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button type="button" onClick={() => void copyUrl(davUrl(w.id))} style={btnGhost}>
                    Copy WebDAV URL
                  </button>
                  {mounted[w.id] ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void unmount(w.id)}
                      style={btnGhost}
                    >
                      Unmount
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void openMount(w)}
                      style={btnGhost}
                    >
                      Mount…
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setAuthed(false);
              setWorkspaces([]);
              setMounted({});
              setMessage('');
            }}
            style={btnGhost}
          >
            Sign out
          </button>
        </>
      )}

      {dialog && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 50,
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setDialog(null);
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 420,
              borderRadius: 14,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              padding: 16,
            }}
          >
            <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Mount {dialog.workspace.name}</h2>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--muted)' }}>
              Uses rclone over WebDAV. Create an app password in the web Account page, then paste it
              below.
            </p>
            <label style={{ display: 'block', marginBottom: 10, fontSize: 13 }}>
              <span style={{ color: 'var(--muted)' }}>Local mount path</span>
              <input
                value={dialog.mountPath}
                onChange={(e) => setDialog({ ...dialog, mountPath: e.target.value })}
                style={inputStyle}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 10, fontSize: 13 }}>
              <span style={{ color: 'var(--muted)' }}>WebDAV username (email)</span>
              <input
                value={dialog.davUser}
                onChange={(e) => setDialog({ ...dialog, davUser: e.target.value })}
                style={inputStyle}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 14, fontSize: 13 }}>
              <span style={{ color: 'var(--muted)' }}>App password</span>
              <input
                type="password"
                value={dialog.davPass}
                onChange={(e) => setDialog({ ...dialog, davPass: e.target.value })}
                placeholder="ark_… from Account"
                style={inputStyle}
              />
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDialog(null)}
                style={btnGhost}
              >
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={() => void confirmMount()} style={btnStyle}>
                {busy ? 'Mounting…' : 'Mount'}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <p style={{ color: '#fca5a5' }}>{error}</p>}
      {message && <p style={{ color: 'var(--amber)' }}>{message}</p>}
    </div>
  );
}

const inputStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 4,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg, #0f1218)',
  color: 'var(--text)',
  boxSizing: 'border-box',
};

const btnStyle: CSSProperties = {
  border: 'none',
  borderRadius: 8,
  padding: '10px 14px',
  fontWeight: 700,
  cursor: 'pointer',
  background: 'linear-gradient(90deg, var(--orange), var(--amber))',
  color: '#111',
};

const btnGhost: CSSProperties = {
  ...btnStyle,
  background: 'transparent',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  fontWeight: 600,
  fontSize: 12,
};
