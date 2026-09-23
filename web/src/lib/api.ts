export type User = {
  id: string;
  email: string;
  display_name: string;
  is_instance_admin: boolean;
  status: 'pending' | 'active' | 'rejected' | 'disabled';
  quota_bytes?: number | null;
  /** Contract §3 — absent on servers without 2FA support. */
  two_factor_enabled?: boolean;
  created_at: string;
};

export type RegisterResult =
  | User
  | { status: 'pending'; message: string; user: User };

export type Workspace = {
  id: string;
  type: 'personal' | 'team' | 'mount';
  name: string;
  role?: string;
  invite_token?: string | null;
  storage_backend_id?: string | null;
  created_at: string;
};

export type Node = {
  id: string;
  workspace_id: string;
  parent_id?: string | null;
  name: string;
  kind: 'file' | 'folder';
  size: number;
  mime?: string | null;
  checksum?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  /** Present on shared-with-me roots. */
  permission?: 'read' | 'write';
};

export type Breadcrumb = { id: string; name: string };

export type WorkspaceMember = {
  user_id: string;
  email: string;
  display_name: string;
  role: string;
  created_at: string;
};

export type Share = {
  id: string;
  node_id: string;
  grantee_user_id?: string | null;
  grantee_workspace_id?: string | null;
  grantee_email?: string | null;
  grantee_name?: string | null;
  permission: 'read' | 'write';
  created_at: string;
};

export type PublicLink = {
  id: string;
  node_id: string;
  token: string;
  has_password: boolean;
  expires_at?: string | null;
  max_downloads?: number | null;
  download_count: number;
  url?: string;
  /** Contract §4 — "upload" links are file requests (folders only). */
  mode?: LinkMode;
  created_at: string;
};

export type LinkMode = 'view' | 'upload';

export type StorageBackend = {
  id: string;
  name: string;
  type: 's3' | 'local' | 'nfs' | 'gdrive' | 'webdav' | 'internxt';
  config: Record<string, unknown>;
  is_default: boolean;
  created_at: string;
};

export type RecentItem = {
  id: string;
  action: string;
  node_id?: string | null;
  node_name?: string | null;
  workspace_id?: string | null;
  parent_id?: string | null;
  created_at: string;
};

export type LiveDriveItem = {
  id: string;
  name: string;
  kind: 'file' | 'folder';
  size: number;
  mime: string;
  modified?: string;
};

export type MigrationJob = {
  id: string;
  workspace_id: string;
  status: string;
  copied: number;
  total: number;
  error: string;
  created_at: string;
  updated_at: string;
};

export type StorageConnection = {
  id: string;
  type: string;
  name: string;
  account_email: string;
  workspace_id?: string | null;
  created_at: string;
};

export type TwoFactorChallenge = { two_factor_required: true; challenge: string };

export function isTwoFactorChallenge(v: unknown): v is TwoFactorChallenge {
  return !!v && typeof v === 'object' && (v as TwoFactorChallenge).two_factor_required === true;
}

export type TwoFactorStatus = { enabled: boolean; recovery_codes_remaining: number };

export type InstanceInfo = {
  version?: string;
  oidc: { enabled: boolean; provider_name: string };
  registration_open: boolean;
  google_drive_enabled: boolean;
  setup_needed: boolean;
};

export type AuditEntry = {
  id: string;
  created_at: string;
  actor_user_id?: string | null;
  actor_email?: string | null;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  ip?: string | null;
  meta?: Record<string, unknown> | null;
};

export type PublicMeta = {
  node_id: string;
  name: string;
  kind: string;
  mime?: string;
  size?: number;
  mode?: LinkMode;
};

/** Error thrown for any non-2xx API response; `status` enables graceful degradation. */
export class ApiError extends Error {
  status: number;
  data?: unknown;
  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/** True when an endpoint does not exist on this server (older backend). */
export function isMissingEndpoint(e: unknown) {
  return e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 501);
}

export function errorMessage(e: unknown, fallback: string) {
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

const NO_REDIRECT_PREFIXES = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/me',
  '/api/auth/forgot',
  '/api/auth/reset',
  '/api/auth/oidc',
  '/api/auth/registration',
  '/api/setup',
  '/api/instance',
];

function redirectToLogin() {
  if (typeof window === 'undefined') return;
  const p = window.location.pathname;
  if (p.startsWith('/login') || p.startsWith('/setup') || p.startsWith('/s/') || p.startsWith('/reset')) return;
  window.location.assign('/login');
}

async function readError(res: Response): Promise<ApiError> {
  let message = res.statusText || `HTTP ${res.status}`;
  let data: unknown;
  try {
    data = await res.json();
    const err = (data as { error?: string })?.error;
    if (err) message = err;
  } catch {
    /* ignore */
  }
  return new ApiError(message, res.status, data);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });
  if (res.status === 401 && !NO_REDIRECT_PREFIXES.some((p) => path.startsWith(p))) {
    redirectToLogin();
  }
  if (!res.ok) throw await readError(res);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type UploadProgress = (loaded: number, total: number) => void;

/**
 * Raw-body upload over XHR (fetch cannot report upload progress). Used for
 * the authenticated PUT upload and public file-request uploads.
 */
export function xhrUpload<T>(
  url: string,
  body: Blob,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    onProgress?: UploadProgress;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open(opts.method || 'PUT', url);
    xhr.withCredentials = true;
    for (const [k, v] of Object.entries(opts.headers || {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded, e.total);
    };
    const onAbort = () => xhr.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    xhr.onload = () => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (xhr.status === 401 && url.startsWith('/api/workspaces')) redirectToLogin();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve((xhr.responseText ? JSON.parse(xhr.responseText) : undefined) as T);
        } catch {
          resolve(undefined as T);
        }
        return;
      }
      let message = xhr.statusText || 'Upload failed';
      let data: unknown;
      try {
        data = JSON.parse(xhr.responseText);
        const err = (data as { error?: string })?.error;
        if (err) message = err;
      } catch {
        /* ignore */
      }
      reject(new ApiError(message, xhr.status, data));
    };
    xhr.onerror = () => reject(new ApiError('Network error', 0));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    xhr.send(body);
  });
}

type Page<T> = { items: T[]; has_more: boolean; next_offset: number };

async function collectPages<T>(fetchPage: (offset: number) => Promise<Page<T>>): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (let i = 0; i < 50; i++) {
    const page = await fetchPage(offset);
    all.push(...(page.items || []));
    if (!page.has_more) break;
    offset = page.next_offset ?? all.length;
  }
  return all;
}

export const api = {
  me: () => request<User>('/api/auth/me'),
  /** Returns the user, or a 2FA challenge when the account has TOTP enabled (§3). */
  login: (email: string, password: string) =>
    request<User | TwoFactorChallenge>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  loginTwoFactor: (challenge: string, code: string) =>
    request<User>('/api/auth/login/2fa', {
      method: 'POST',
      body: JSON.stringify({ challenge, code }),
    }),
  instance: () => request<InstanceInfo>('/api/instance'),
  setupStatus: () => request<{ needed: boolean; token_required?: boolean }>('/api/setup'),
  setup: (body: { email: string; password: string; display_name: string; setup_token?: string }) =>
    request<User>('/api/setup', { method: 'POST', body: JSON.stringify(body) }),
  twoFactorStatus: () => request<TwoFactorStatus>('/api/me/2fa'),
  twoFactorSetup: () =>
    request<{ secret: string; otpauth_url: string }>('/api/me/2fa/setup', { method: 'POST' }),
  twoFactorEnable: (code: string) =>
    request<{ recovery_codes: string[] }>('/api/me/2fa/enable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  twoFactorDisable: (password: string, code: string) =>
    request<{ enabled: boolean }>('/api/me/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({ password, code }),
    }),
  twoFactorRegenerate: (code: string) =>
    request<{ recovery_codes: string[] }>('/api/me/2fa/recovery-codes', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  adminResetTwoFactor: (userId: string) =>
    request<{ status: string }>(`/api/admin/users/${userId}/2fa/reset`, { method: 'POST' }),
  versionSettings: () => request<{ max_versions: number }>('/api/admin/settings/versions'),
  putVersionSettings: (max_versions: number) =>
    request<{ max_versions: number }>('/api/admin/settings/versions', {
      method: 'PUT',
      body: JSON.stringify({ max_versions }),
    }),
  audit: (params: { limit?: number; cursor?: string | null; action?: string; actor?: string }) => {
    const q = new URLSearchParams({ limit: String(params.limit ?? 50) });
    if (params.cursor) q.set('cursor', params.cursor);
    if (params.action) q.set('action', params.action);
    if (params.actor) q.set('actor', params.actor);
    return request<{ items: AuditEntry[]; next_cursor: string | null }>(`/api/admin/audit?${q}`);
  },
  forgotPassword: (email: string) =>
    request<{ status: string; message: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, password: string) =>
    request<{ status: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),
  register: (email: string, password: string, display_name: string) =>
    request<RegisterResult>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, display_name }),
    }),
  adminUsers: async (status?: string) => {
    return collectPages<User>((offset) => {
      const q = new URLSearchParams({ limit: '200', offset: String(offset) });
      if (status) q.set('status', status);
      return request<Page<User>>(`/api/admin/users?${q}`);
    });
  },
  disableUser: (userId: string) =>
    request<User>(`/api/admin/users/${userId}/disable`, { method: 'POST' }),
  deleteUser: (userId: string) =>
    request<{ status: string }>(`/api/admin/users/${userId}`, { method: 'DELETE' }),
  setInstanceAdmin: (userId: string, is_instance_admin: boolean) =>
    request<User>(`/api/admin/users/${userId}/admin`, {
      method: 'PATCH',
      body: JSON.stringify({ is_instance_admin }),
    }),
  approveUser: (userId: string) =>
    request<User>(`/api/admin/users/${userId}/approve`, { method: 'POST' }),
  rejectUser: (userId: string) =>
    request<User>(`/api/admin/users/${userId}/reject`, { method: 'POST' }),
  setUserQuota: (userId: string, quota_bytes: number | null) =>
    request<{ status: string }>(`/api/admin/users/${userId}/quota`, {
      method: 'PATCH',
      body: JSON.stringify({ quota_bytes }),
    }),
  setWorkspaceQuota: (workspaceId: string, quota_bytes: number | null) =>
    request<{ status: string }>(`/api/admin/workspaces/${workspaceId}/quota`, {
      method: 'PATCH',
      body: JSON.stringify({ quota_bytes }),
    }),
  quotaSettings: () =>
    request<{ default_workspace_quota_bytes: number | null }>('/api/admin/settings/quota'),
  putQuotaSettings: (default_workspace_quota_bytes: number | null) =>
    request<{ status: string }>('/api/admin/settings/quota', {
      method: 'PUT',
      body: JSON.stringify({ default_workspace_quota_bytes }),
    }),
  trashSettings: () =>
    request<{ trash_retention_days: number }>('/api/admin/settings/trash'),
  putTrashSettings: (trash_retention_days: number) =>
    request<{ status: string; trash_retention_days: number }>('/api/admin/settings/trash', {
      method: 'PUT',
      body: JSON.stringify({ trash_retention_days }),
    }),
  reindexSearch: () =>
    request<{ status: string; indexed: number; remaining: number }>('/api/admin/search/reindex', {
      method: 'POST',
    }),
  registrationSettings: () =>
    request<{ registration_open: boolean }>('/api/admin/settings/registration'),
  putRegistrationSettings: (registration_open: boolean) =>
    request<{ status: string; registration_open: boolean }>('/api/admin/settings/registration', {
      method: 'PUT',
      body: JSON.stringify({ registration_open }),
    }),
  registrationOpen: () => request<{ open: boolean }>('/api/auth/registration'),
  logout: () => request<{ status: string }>('/api/auth/logout', { method: 'POST' }),
  updateProfile: (display_name: string, password?: string) =>
    request<User>('/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ display_name, password: password || undefined }),
    }),
  listAppPasswords: () =>
    request<
      {
        id: string;
        name: string;
        prefix: string;
        created_at: string;
        last_used_at?: string | null;
      }[]
    >('/api/me/app-passwords'),
  createAppPassword: (name: string) =>
    request<{
      id: string;
      name: string;
      prefix: string;
      secret: string;
      created_at: string;
      last_used_at?: string | null;
    }>('/api/me/app-passwords', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  revokeAppPassword: (id: string) =>
    request<{ status: string }>(`/api/me/app-passwords/${id}`, { method: 'DELETE' }),
  workspaces: () => request<Workspace[]>('/api/workspaces'),
  createTeam: (name: string) =>
    request<Workspace>('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  joinTeam: (token: string) =>
    request<Workspace>('/api/workspaces/join', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  members: (workspaceId: string) =>
    request<WorkspaceMember[]>(`/api/workspaces/${workspaceId}/members`),
  rotateInvite: (workspaceId: string) =>
    request<{ invite_token: string }>(`/api/workspaces/${workspaceId}/invite`, {
      method: 'POST',
    }),
  sendInvite: (workspaceId: string, email: string) =>
    request<{ status: string }>(`/api/workspaces/${workspaceId}/invite/send`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  removeMember: (workspaceId: string, userId: string) =>
    request<{ status: string }>(`/api/workspaces/${workspaceId}/members/${userId}`, {
      method: 'DELETE',
    }),
  updateMember: (workspaceId: string, userId: string, role: string) =>
    request<{ status: string }>(`/api/workspaces/${workspaceId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
  workspaceUsage: (workspaceId: string) =>
    request<{ bytes: number; files: number; quota_bytes?: number | null }>(
      `/api/workspaces/${workspaceId}/usage`,
    ),
  storageUsage: () =>
    request<{
      bytes: number;
      files: number;
      quota_bytes?: number | null;
      by_workspace: {
        id: string;
        name: string;
        type: string;
        bytes: number;
        files: number;
        quota_bytes?: number | null;
      }[];
    }>('/api/storage/usage'),
  listNodes: async (workspaceId: string, parentId?: string | null, init?: RequestInit) => {
    const nodes: Node[] = [];
    let breadcrumbs: Breadcrumb[] = [];
    let offset = 0;
    for (let i = 0; i < 50; i++) {
      const q = new URLSearchParams({ limit: '200', offset: String(offset) });
      if (parentId) q.set('parent_id', parentId);
      const data = await request<{
        nodes: Node[];
        breadcrumbs: Breadcrumb[];
        has_more: boolean;
        next_offset: number;
      }>(`/api/workspaces/${workspaceId}/nodes?${q}`, init);
      breadcrumbs = data.breadcrumbs || [];
      nodes.push(...(data.nodes || []));
      if (!data.has_more) break;
      offset = data.next_offset ?? nodes.length;
    }
    return { nodes, breadcrumbs };
  },
  mkdir: (workspaceId: string, name: string, parentId?: string | null) =>
    request<Node>(`/api/workspaces/${workspaceId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ name, parent_id: parentId || null }),
    }),
  upload: (
    workspaceId: string,
    file: File,
    parentId: string | null | undefined,
    opts: { onProgress?: UploadProgress; signal?: AbortSignal; name?: string } = {},
  ) => {
    const name = opts.name || file.name;
    const q = new URLSearchParams({ name });
    if (parentId) q.set('parent_id', parentId);
    return xhrUpload<Node>(`/api/workspaces/${workspaceId}/upload?${q}`, file, {
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      onProgress: opts.onProgress,
      signal: opts.signal,
    });
  },
  putNodeContent: (nodeId: string, body: string, mime?: string | null) =>
    request<Node>(`/api/nodes/${nodeId}/content`, {
      method: 'PUT',
      headers: { 'Content-Type': mime || 'text/plain; charset=utf-8' },
      body,
    }),
  rename: (nodeId: string, name: string, parentId?: string | null) =>
    request<Node>(`/api/nodes/${nodeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, parent_id: parentId }),
    }),
  move: (nodeId: string, name: string, parentId: string | null) =>
    request<Node>(`/api/nodes/${nodeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, parent_id: parentId, move: true }),
    }),
  remove: (nodeId: string) =>
    request<{ status: string }>(`/api/nodes/${nodeId}`, { method: 'DELETE' }),
  search: (workspaceId: string, q: string, init?: RequestInit) =>
    request<Node[]>(
      `/api/workspaces/${workspaceId}/search?q=${encodeURIComponent(q)}`,
      init,
    ),
  searchAll: (q: string, init?: RequestInit) =>
    request<Node[]>(`/api/search?q=${encodeURIComponent(q)}`, init),
  downloadZip: async (workspaceId: string, nodeIds: string[]) => {
    const res = await fetch(`/api/workspaces/${workspaceId}/download-zip`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_ids: nodeIds }),
    });
    if (!res.ok) throw await readError(res);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'arkive.zip';
    a.click();
    URL.revokeObjectURL(url);
  },
  oidcEnabled: () =>
    request<{ enabled: boolean; provider_name: string }>('/api/auth/oidc/enabled'),
  trash: async (workspaceId: string, init?: RequestInit) =>
    collectPages<Node>((offset) =>
      request<Page<Node>>(
        `/api/workspaces/${workspaceId}/trash?limit=200&offset=${offset}`,
        init,
      ),
    ),
  emptyTrash: (workspaceId: string) =>
    request<{ status: string; purged: number }>(`/api/workspaces/${workspaceId}/trash`, {
      method: 'DELETE',
    }),
  restore: (nodeId: string) =>
    request<{ status: string }>(`/api/nodes/${nodeId}/restore`, { method: 'POST' }),
  purge: (nodeId: string) =>
    request<{ status: string }>(`/api/nodes/${nodeId}/purge`, { method: 'DELETE' }),
  copyNodes: (
    node_ids: string[],
    target_workspace_id: string,
    target_parent_id?: string | null,
  ) =>
    request<{ nodes: Node[] }>('/api/nodes/copy', {
      method: 'POST',
      body: JSON.stringify({ node_ids, target_workspace_id, target_parent_id: target_parent_id || null }),
    }),
  recentActivity: (init?: RequestInit) =>
    request<RecentItem[]>('/api/activity/recent', init),
  liveDriveList: (parent?: string, init?: RequestInit) => {
    const q = parent ? `?parent=${encodeURIComponent(parent)}` : '';
    return request<{ items: LiveDriveItem[]; parent: string }>(
      `/api/storage/google/live${q}`,
      init,
    );
  },
  liveDriveDownloadUrl: (id: string) =>
    `/api/storage/google/live/download?id=${encodeURIComponent(id)}`,
  liveDriveUpload: async (file: File, parent: string) => {
    const q = new URLSearchParams({ name: file.name, parent: parent || 'root' });
    const res = await fetch(`/api/storage/google/live/upload?${q}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!res.ok) throw await readError(res);
    return res.json() as Promise<LiveDriveItem>;
  },
  liveDriveMove: (file_id: string, new_parent_id: string, old_parent_id?: string) =>
    request<LiveDriveItem>('/api/storage/google/live/move', {
      method: 'POST',
      body: JSON.stringify({ file_id, new_parent_id, old_parent_id: old_parent_id || '' }),
    }),
  connectWebDAV: (body: {
    type: 'webdav' | 'internxt';
    name?: string;
    url: string;
    username?: string;
    password?: string;
  }) =>
    request<{ status: string; connection_id: string; workspace_id: string; name: string }>(
      '/api/storage/webdav',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  migrationJob: (jobId: string) => request<MigrationJob>(`/api/migrations/${jobId}`),
  smtpSettings: () =>
    request<{
      enabled: boolean;
      host: string;
      port: string;
      user: string;
      from: string;
      has_password: boolean;
      source: string;
    }>('/api/admin/settings/smtp'),
  saveSMTPSettings: (body: {
    host?: string;
    port?: string;
    user?: string;
    password?: string;
    from?: string;
    clear?: boolean;
  }) =>
    request<{
      enabled: boolean;
      host: string;
      port: string;
      user: string;
      from: string;
      has_password: boolean;
      source: string;
    }>('/api/admin/settings/smtp', { method: 'PUT', body: JSON.stringify(body) }),
  shares: (nodeId: string) => request<Share[]>(`/api/nodes/${nodeId}/shares`),
  createShare: (
    nodeId: string,
    body: { grantee_email?: string; grantee_workspace_id?: string; permission: string },
  ) =>
    request<Share>(`/api/nodes/${nodeId}/shares`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteShare: (shareId: string) =>
    request<{ status: string }>(`/api/shares/${shareId}`, { method: 'DELETE' }),
  sharedWithMe: async (init?: RequestInit) =>
    collectPages<Node>((offset) =>
      request<Page<Node>>(`/api/shared?limit=200&offset=${offset}`, init),
    ),
  links: (nodeId: string) => request<PublicLink[]>(`/api/nodes/${nodeId}/links`),
  createLink: (
    nodeId: string,
    body: {
      password?: string;
      expires_at?: string | null;
      max_downloads?: number | null;
      mode?: LinkMode;
    },
  ) =>
    request<PublicLink>(`/api/nodes/${nodeId}/links`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteLink: (linkId: string) =>
    request<{ status: string }>(`/api/links/${linkId}`, { method: 'DELETE' }),
  versions: (nodeId: string) =>
    request<
      { version: number; size: number; mime?: string; created_at: string; created_by?: string }[]
    >(`/api/nodes/${nodeId}/versions`),
  restoreVersion: (nodeId: string, version: number) =>
    request<{ status: string }>(`/api/nodes/${nodeId}/versions/${version}/restore`, {
      method: 'POST',
    }),
  activity: (nodeId: string) =>
    request<
      { id: string; action: string; actor?: string; detail: Record<string, unknown>; created_at: string }[]
    >(`/api/nodes/${nodeId}/activity`),
  publicMeta: async (token: string, password?: string) => {
    const res = await fetch(`/api/public/${token}`, {
      credentials: 'include',
      headers: password ? { 'X-Link-Password': password } : {},
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || res.statusText, res.status, data);
    return data as PublicMeta;
  },
  /** §4 — upload into an upload-only link. Name collisions are auto-renamed server side. */
  publicUpload: (
    token: string,
    file: File,
    opts: { password?: string; onProgress?: UploadProgress; signal?: AbortSignal } = {},
  ) =>
    xhrUpload<{ name: string; size: number }>(
      `/api/public/${token}/upload?${new URLSearchParams({ name: file.name })}`,
      file,
      {
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          ...(opts.password ? { 'X-Link-Password': opts.password } : {}),
        },
        onProgress: opts.onProgress,
        signal: opts.signal,
      },
    ),
  publicNodes: async (token: string, parentId?: string | null, password?: string) => {
    const q = parentId ? `?parent_id=${encodeURIComponent(parentId)}` : '';
    const res = await fetch(`/api/public/${token}/nodes${q}`, {
      credentials: 'include',
      headers: password ? { 'X-Link-Password': password } : {},
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || res.statusText, res.status, data);
    return data as {
      root: { id: string; name: string; kind: string };
      nodes: Node[];
      breadcrumbs: Breadcrumb[];
    };
  },
  publicDownloadUrl: (token: string, nodeId?: string) => {
    const q = nodeId ? `?node_id=${encodeURIComponent(nodeId)}` : '';
    return `/api/public/${token}/download${q}`;
  },
  publicDownload: async (token: string, nodeId?: string, password?: string) => {
    const res = await fetch(api.publicDownloadUrl(token, nodeId), {
      credentials: 'include',
      headers: password ? { 'X-Link-Password': password } : {},
    });
    if (!res.ok) throw await readError(res);
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const match = /filename="([^"]+)"/.exec(cd);
    return { blob, filename: match?.[1] || 'download' };
  },
  publicDownloadZip: async (token: string, nodeIds?: string[], password?: string) => {
    const res = await fetch(`/api/public/${token}/download-zip`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(password ? { 'X-Link-Password': password } : {}),
      },
      body: JSON.stringify({ node_ids: nodeIds || [] }),
    });
    if (!res.ok) throw await readError(res);
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const match = /filename="([^"]+)"/.exec(cd);
    return { blob, filename: match?.[1] || 'arkive.zip' };
  },
  backends: () => request<StorageBackend[]>('/api/admin/backends'),
  createBackend: (body: {
    name: string;
    type: string;
    config: Record<string, unknown>;
    is_default?: boolean;
  }) =>
    request<StorageBackend>('/api/admin/backends', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateBackend: (id: string, body: { name?: string; config?: Record<string, unknown> }) =>
    request<StorageBackend>(`/api/admin/backends/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteBackend: (id: string) =>
    request<{ status: string }>(`/api/admin/backends/${id}`, { method: 'DELETE' }),
  testBackend: (id: string) =>
    request<{ status: string }>(`/api/admin/backends/${id}/test`, { method: 'POST' }),
  setDefaultBackend: (id: string) =>
    request<{ status: string }>(`/api/admin/backends/${id}/default`, { method: 'POST' }),
  assignWorkspaceBackend: (
    workspaceId: string,
    storage_backend_id: string,
    migrate: boolean = false,
  ) =>
    request<{
      status: string;
      storage_backend_id: string;
      migrated: boolean;
      copied: number;
      total: number;
    }>(`/api/admin/workspaces/${workspaceId}/backend`, {
      method: 'PATCH',
      body: JSON.stringify({ storage_backend_id, migrate }),
    }),
  googleDriveEnabled: () => request<{ enabled: boolean }>('/api/storage/google/enabled'),
  storageConnections: () => request<StorageConnection[]>('/api/storage/connections'),
  disconnectStorage: (connectionId: string) =>
    request<{ status: string }>(`/api/storage/connections/${connectionId}`, { method: 'DELETE' }),
  assignWorkspaceStorage: (
    workspaceId: string,
    body: { use_default?: boolean; storage_backend_id?: string | null; migrate?: boolean },
  ) =>
    request<{
      status: string;
      storage_backend_id: string;
      migrated: boolean;
      copied: number;
      total: number;
    }>(`/api/workspaces/${workspaceId}/storage`, {
      method: 'PATCH',
      body: JSON.stringify({ migrate: false, ...body }),
    }),
  migrateWorkspace: (
    workspaceId: string,
    body: { use_default?: boolean; storage_backend_id?: string },
    sync = false,
  ) =>
    request<{
      status: string;
      storage_backend_id?: string;
      migrated?: boolean;
      copied?: number;
      total?: number;
      job?: MigrationJob;
      job_url?: string;
    }>(`/api/workspaces/${workspaceId}/migrate${sync ? '?sync=1' : ''}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  googleSettings: () =>
    request<{
      enabled: boolean;
      client_id: string;
      has_secret: boolean;
      redirect_url: string;
      source: 'env' | 'db' | 'none';
    }>('/api/admin/settings/google'),
  saveGoogleSettings: (body: {
    client_id?: string;
    client_secret?: string;
    redirect_url?: string;
    clear?: boolean;
  }) =>
    request<{
      enabled: boolean;
      client_id: string;
      has_secret: boolean;
      redirect_url: string;
      source: 'env' | 'db' | 'none';
    }>('/api/admin/settings/google', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};

export function downloadUrl(nodeId: string) {
  return `/api/nodes/${nodeId}/download`;
}

export function contentUrl(nodeId: string) {
  return `/api/nodes/${nodeId}/content`;
}

export function thumbUrl(nodeId: string) {
  return `/api/nodes/${nodeId}/thumb`;
}

export function isPreviewable(node: Node) {
  if (node.kind !== 'file') return false;
  const mime = (node.mime || '').toLowerCase();
  const name = node.name.toLowerCase();
  // Never inline HTML/SVG in the app origin (stored XSS).
  if (
    mime.includes('html') ||
    mime.includes('svg') ||
    /\.(html?|svgz?)$/i.test(name)
  ) {
    return false;
  }
  if (
    mime.startsWith('image/') ||
    mime.startsWith('video/') ||
    mime.startsWith('audio/') ||
    mime === 'application/pdf' ||
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/javascript' ||
    mime === 'application/x-sh' ||
    mime === 'application/x-yaml'
  ) {
    return true;
  }
  return /\.(png|jpe?g|gif|webp|bmp|avif|ico|jfif|pdf|mp4|webm|ogg|ogv|mov|m4v|mkv|mp3|wav|oga|m4a|flac|aac|opus|txt|md|markdown|json|ya?ml|toml|csv|tsv|log|go|tsx?|jsx?|mjs|cjs|py|rs|css|scss|less|xml|sh|bash|zsh|ini|conf|cfg|env|sql|rb|java|kt|c|cc|cpp|h|hpp|php|vue|svelte|swift|dart|lua|r|pl|ps1)$/i.test(
    name,
  );
}

export { formatBytes } from '../i18n/format';
