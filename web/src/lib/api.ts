export type User = {
  id: string;
  email: string;
  display_name: string;
  is_instance_admin: boolean;
  status: 'pending' | 'active' | 'rejected';
  quota_bytes?: number | null;
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
  url?: string;
  created_at: string;
};

export type StorageBackend = {
  id: string;
  name: string;
  type: 's3' | 'nfs' | 'gdrive' | 'webdav' | 'internxt';
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<User>('/api/auth/me'),
  login: (email: string, password: string) =>
    request<User>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string, display_name: string) =>
    request<RegisterResult>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, display_name }),
    }),
  adminUsers: (status?: string) => {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    return request<User[]>(`/api/admin/users${q}`);
  },
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
  reindexSearch: () =>
    request<{ status: string; indexed: number }>('/api/admin/search/reindex', { method: 'POST' }),
  logout: () => request<{ status: string }>('/api/auth/logout', { method: 'POST' }),
  updateProfile: (display_name: string, password?: string) =>
    request<User>('/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ display_name, password: password || undefined }),
    }),
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
  listNodes: (workspaceId: string, parentId?: string | null) => {
    const q = parentId ? `?parent_id=${parentId}` : '';
    return request<{ nodes: Node[]; breadcrumbs: Breadcrumb[] }>(
      `/api/workspaces/${workspaceId}/nodes${q}`,
    );
  },
  mkdir: (workspaceId: string, name: string, parentId?: string | null) =>
    request<Node>(`/api/workspaces/${workspaceId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ name, parent_id: parentId || null }),
    }),
  upload: async (
    workspaceId: string,
    file: File,
    parentId: string | null | undefined,
    onProgress?: (pct: number) => void,
  ) => {
    const q = new URLSearchParams({ name: file.name });
    if (parentId) q.set('parent_id', parentId);
    return new Promise<Node>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', `/api/workspaces/${workspaceId}/upload?${q}`);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.setRequestHeader('X-File-Name', file.name);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText) as Node);
        } else {
          try {
            reject(new Error((JSON.parse(xhr.responseText) as { error: string }).error));
          } catch {
            reject(new Error('upload failed'));
          }
        }
      };
      xhr.onerror = () => reject(new Error('upload failed'));
      xhr.send(file);
    });
  },
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
  search: (workspaceId: string, q: string) =>
    request<Node[]>(`/api/workspaces/${workspaceId}/search?q=${encodeURIComponent(q)}`),
  downloadZip: async (workspaceId: string, nodeIds: string[]) => {
    const res = await fetch(`/api/workspaces/${workspaceId}/download-zip`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_ids: nodeIds }),
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const data = (await res.json()) as { error?: string };
        if (data.error) message = data.error;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
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
  trash: (workspaceId: string) => request<Node[]>(`/api/workspaces/${workspaceId}/trash`),
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
  recentActivity: () => request<RecentItem[]>('/api/activity/recent'),
  liveDriveList: (parent?: string) => {
    const q = parent ? `?parent=${encodeURIComponent(parent)}` : '';
    return request<{ items: LiveDriveItem[]; parent: string }>(`/api/storage/google/live${q}`);
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
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || 'Upload failed');
    }
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
  sharedWithMe: () => request<Node[]>('/api/shared'),
  links: (nodeId: string) => request<PublicLink[]>(`/api/nodes/${nodeId}/links`),
  createLink: (nodeId: string, body: { password?: string; expires_at?: string | null }) =>
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
      headers: password ? { 'X-Link-Password': password } : {},
    });
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status, data });
    return data as { node_id: string; name: string; kind: string; mime?: string };
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
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico|jfif|pdf|mp4|webm|ogg|ogv|mov|m4v|mkv|mp3|wav|oga|m4a|flac|aac|opus|txt|md|markdown|json|ya?ml|toml|csv|tsv|log|go|tsx?|jsx?|mjs|cjs|py|rs|css|scss|less|html?|xml|sh|bash|zsh|ini|conf|cfg|env|sql|rb|java|kt|c|cc|cpp|h|hpp|php|vue|svelte|swift|dart|lua|r|pl|ps1)$/i.test(
    name,
  );
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
