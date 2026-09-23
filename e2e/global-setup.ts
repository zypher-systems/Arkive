import { request } from '@playwright/test';
import { ADMIN, BASE_URL, SETUP_TOKEN, fakeIP } from './lib/env';

// Completes first-run setup on a fresh instance (the stack is started with a
// known ARKIVE_SETUP_TOKEN), or checks the admin can log in on a reused one.
export default async function globalSetup() {
  const ctx = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'X-Forwarded-For': fakeIP() } });
  try {
    let status: { needed: boolean } | undefined;
    for (let i = 0; i < 60; i++) {
      try {
        const res = await ctx.get('/api/setup');
        if (res.ok()) {
          status = await res.json();
          break;
        }
      } catch {
        // stack still starting
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!status) throw new Error(`Arkive is not reachable at ${BASE_URL}`);
    if (status.needed) {
      if (!SETUP_TOKEN) throw new Error('fresh instance: set ARKIVE_SETUP_TOKEN to the token the stack was started with');
      const res = await ctx.post('/api/setup', {
        data: { email: ADMIN.email, password: ADMIN.password, display_name: ADMIN.name, setup_token: SETUP_TOKEN },
      });
      if (res.status() !== 201) throw new Error(`setup failed: ${res.status()} ${await res.text()}`);
    }
    const login = await ctx.post('/api/auth/login', { data: { email: ADMIN.email, password: ADMIN.password } });
    if (!login.ok()) {
      throw new Error(
        `admin login failed (${login.status()}): set ARKIVE_E2E_ADMIN_EMAIL / ARKIVE_E2E_ADMIN_PASSWORD for a reused instance`,
      );
    }
    // Keep the instance permissive for the suite: open registration.
    await ctx.put('/api/admin/settings/registration', { data: { registration_open: true } });
  } finally {
    await ctx.dispose();
  }
}
