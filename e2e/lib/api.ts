import { expect, request, type APIRequestContext, type APIResponse } from '@playwright/test';
import { ADMIN, BASE_URL, fakeIP, uniq } from './env';

export type User = { id: string; email: string; password: string; name: string };
export type Node = { id: string; name: string; kind: 'file' | 'folder'; parent_id?: string | null; workspace_id: string };
export type Workspace = { id: string; name: string; type: string; invite_token?: string };

async function ok(res: APIResponse, what: string): Promise<APIResponse> {
  if (!res.ok()) {
    throw new Error(`${what}: ${res.status()} ${await res.text()}`);
  }
  return res;
}

/** A thin typed client over Playwright's request context (cookies kept). */
export class Api {
  constructor(public readonly ctx: APIRequestContext) {}

  static async anonymous(ip = fakeIP()): Promise<Api> {
    return new Api(await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'X-Forwarded-For': ip } }));
  }

  static async as(user: { email: string; password: string }, ip = fakeIP()): Promise<Api> {
    const api = await Api.anonymous(ip);
    await api.login(user.email, user.password);
    return api;
  }

  static admin(ip = fakeIP()): Promise<Api> {
    return Api.as(ADMIN, ip);
  }

  async dispose() {
    await this.ctx.dispose();
  }

  async login(email: string, password: string) {
    const res = await ok(await this.ctx.post('/api/auth/login', { data: { email, password } }), `login ${email}`);
    return res.json();
  }

  async json<T>(method: string, url: string, data?: unknown): Promise<T> {
    const res = await ok(await this.ctx.fetch(url, { method, data }), `${method} ${url}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  get<T>(url: string) {
    return this.json<T>('GET', url);
  }

  async me(): Promise<{ id: string; email: string }> {
    return this.get('/api/auth/me');
  }

  async workspaces(): Promise<Workspace[]> {
    return this.get('/api/workspaces');
  }

  async personal(): Promise<Workspace> {
    const ws = (await this.workspaces()).find((w) => w.type === 'personal');
    expect(ws, 'personal workspace').toBeTruthy();
    return ws!;
  }

  async mkdir(ws: string, name: string, parentId?: string): Promise<Node> {
    return this.json('POST', `/api/workspaces/${ws}/folders`, { name, parent_id: parentId ?? null });
  }

  async upload(ws: string, name: string, body: string | Buffer, parentId?: string, mime = 'application/octet-stream'): Promise<Node> {
    const q = new URLSearchParams({ name });
    if (parentId) q.set('parent_id', parentId);
    const res = await ok(
      await this.ctx.put(`/api/workspaces/${ws}/upload?${q}`, { data: body, headers: { 'Content-Type': mime } }),
      `upload ${name}`,
    );
    return res.json();
  }

  async list(ws: string, parentId?: string): Promise<Node[]> {
    const q = parentId ? `?parent_id=${parentId}` : '';
    const out = await this.get<{ nodes: Node[] }>(`/api/workspaces/${ws}/nodes${q}`);
    return out.nodes;
  }

  async download(nodeId: string): Promise<Buffer> {
    const res = await ok(await this.ctx.get(`/api/nodes/${nodeId}/download`), `download ${nodeId}`);
    return res.body();
  }

  async share(nodeId: string, body: { grantee_email?: string; grantee_workspace_id?: string; permission: 'read' | 'write' }) {
    return this.json<{ id: string }>('POST', `/api/nodes/${nodeId}/shares`, body);
  }

  async links(nodeId: string): Promise<{ id: string; token: string; mode: string; has_password: boolean; expires_at?: string | null }[]> {
    return this.get(`/api/nodes/${nodeId}/links`);
  }

  async createTeam(name: string): Promise<Workspace> {
    return this.json('POST', '/api/workspaces', { name });
  }

  async joinTeam(token: string): Promise<Workspace> {
    return this.json('POST', '/api/workspaces/join', { token });
  }
}

/** Registers a user, approves it as admin and returns its credentials. */
export async function newUser(prefix = 'user'): Promise<User> {
  const name = uniq(prefix);
  const user = { email: `${name}@e2e.arkive.test`, password: 'e2e-user-password', name: `User ${name}` };
  const anon = await Api.anonymous();
  const reg = await anon.json<{ user: { id: string }; status: string }>('POST', '/api/auth/register', {
    email: user.email,
    password: user.password,
    display_name: user.name,
  });
  await anon.dispose();
  const admin = await Api.admin();
  await admin.json('POST', `/api/admin/users/${reg.user.id}/approve`);
  await admin.dispose();
  return { ...user, id: reg.user.id };
}
