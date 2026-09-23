// Shared constants for the suite. The admin is created by global-setup on a
// fresh instance (with ARKIVE_SETUP_TOKEN) or must already exist.
export const BASE_URL = process.env.ARKIVE_E2E_URL || 'http://localhost:3080';
export const SETUP_TOKEN = process.env.ARKIVE_SETUP_TOKEN || '';
export const ADMIN = {
  email: process.env.ARKIVE_E2E_ADMIN_EMAIL || 'admin@e2e.arkive.test',
  password: process.env.ARKIVE_E2E_ADMIN_PASSWORD || 'e2e-admin-password',
  name: 'E2E Admin',
};

/**
 * A fake client address per test. The stack under test trusts X-Forwarded-For
 * from local peers (ARKIVE_TRUSTED_PROXIES), so each test gets its own
 * rate-limit bucket for login/register instead of sharing one IP.
 */
export function fakeIP(): string {
  const b = () => Math.floor(Math.random() * 250) + 1;
  return `10.${b()}.${b()}.${b()}`;
}

export function uniq(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
