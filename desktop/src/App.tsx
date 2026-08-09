import { useEffect, useState, type CSSProperties } from 'react';

type Workspace = {
  id: string;
  name: string;
  type: string;
};

const ORIGIN_KEY = 'arkive.desktop.origin';

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

  useEffect(() => {
    localStorage.setItem(ORIGIN_KEY, origin.replace(/\/$/, ''));
  }, [origin]);

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

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 28, margin: '0 0 8px' }}>Arkive</h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Thin desktop helper — mount workspaces over WebDAV.
      </p>

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
              <div style={{ marginTop: 8 }}>
                <button type="button" onClick={() => void copyUrl(davUrl(w.id))} style={btnGhost}>
                  Copy WebDAV URL
                </button>
              </div>
            </li>
          ))}
        </ul>
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
  background: 'var(--surface)',
  color: 'var(--text)',
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
