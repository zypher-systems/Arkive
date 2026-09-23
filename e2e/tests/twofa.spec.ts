import { test, expect, loginAs } from '../lib/fixtures';
import { Api } from '../lib/api';
import { ADMIN, BASE_URL } from '../lib/env';
import { TotpDevice } from '../lib/totp';
import type { Page } from '@playwright/test';

async function signOut(page: Page, name: string) {
  await page.getByRole('button', { name: `Account menu for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function passwordStep(page: Page, email: string, password: string) {
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
}

/** Turns 2FA on through the API; returns the device and the recovery codes. */
async function enable2fa(api: Api) {
  const setup = await api.json<{ secret: string }>('POST', '/api/me/2fa/setup');
  const device = new TotpDevice(setup.secret);
  const res = await api.json<{ recovery_codes: string[] }>('POST', '/api/me/2fa/enable', { code: device.next() });
  return { device, codes: res.recovery_codes };
}

function davAuth(user: string, pass: string) {
  return { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` };
}

test('enable 2FA in Account, sign in with a code and with a recovery code', async ({ page, request, user, userApi }) => {
  const ws = await userApi.personal();
  await loginAs(page, user, '/account/security');

  const setupRes = page.waitForResponse((r) => r.url().endsWith('/api/me/2fa/setup') && r.ok());
  await page.getByRole('button', { name: 'Set up two-factor' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set up two-factor authentication' });
  const device = new TotpDevice((await (await setupRes).json()).secret);
  // The manual key shown under the QR code is the same secret.
  await expect(dialog.getByText(device.secret.slice(0, 4))).toBeVisible();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('textbox', { name: 'Authentication code' }).fill(device.next());
  const enableRes = page.waitForResponse((r) => r.url().endsWith('/api/me/2fa/enable'));
  await dialog.getByRole('button', { name: 'Verify & turn on' }).click();
  const codes: string[] = (await (await enableRes).json()).recovery_codes;
  expect(codes.length).toBeGreaterThanOrEqual(8);
  const codesDialog = page.getByRole('dialog', { name: 'Save your recovery codes' });
  await expect(codesDialog.getByText(codes[0])).toBeVisible();
  await codesDialog.getByRole('checkbox', { name: 'I’ve saved these codes somewhere safe' }).check();
  await codesDialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Two-factor authentication is on').first()).toBeVisible();

  // Sign in again with a TOTP code.
  await signOut(page, user.name);
  await passwordStep(page, user.email, user.password);
  await page.getByRole('textbox', { name: 'Authentication code' }).fill(device.next());
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('button', { name: `Account menu for ${user.name}` })).toBeVisible();

  // …and with a recovery code.
  await signOut(page, user.name);
  await passwordStep(page, user.email, user.password);
  await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
  await page.getByRole('textbox', { name: 'Recovery code' }).fill(codes[1]);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('button', { name: `Account menu for ${user.name}` })).toBeVisible();

  // WebDAV (a client without the browser session): with 2FA on, the account
  // password is refused; an app password works.
  const dav = `${BASE_URL}/dav/${ws.id}/`;
  const refused = await request.fetch(dav, { method: 'PROPFIND', headers: { Depth: '0', ...davAuth(user.email, user.password) } });
  expect(refused.status()).toBe(401);
  await page.goto('/account/webdav');
  await page.getByRole('textbox', { name: 'Name' }).fill('e2e laptop');
  const created = page.waitForResponse((r) => r.url().endsWith('/api/me/app-passwords') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create app password' }).click();
  const secret: string = (await (await created).json()).secret;
  await expect(page.getByText('Copy this password now — it won’t be shown again.')).toBeVisible();
  const ok = await request.fetch(dav, { method: 'PROPFIND', headers: { Depth: '0', ...davAuth(user.email, secret) } });
  expect(ok.status()).toBe(207);
});

test('an expired 2FA challenge sends you back to the password step', async ({ page, user, userApi }) => {
  const { device } = await enable2fa(userApi);
  await page.goto('/login');
  await passwordStep(page, user.email, user.password);
  // Five wrong codes burn the challenge; the next attempt must start over.
  const wrong = device.next() === '000000' ? '111111' : '000000';
  for (let i = 0; i < 6; i++) {
    const code = page.getByRole('textbox', { name: 'Authentication code' });
    if (!(await code.isVisible())) break;
    await code.fill(wrong);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('alert').or(page.getByRole('status')).first()).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByText('That sign-in attempt expired. Please enter your password again.')).toBeVisible();
});

test('admin resets a user’s 2FA', async ({ page, user, userApi }) => {
  await enable2fa(userApi);
  await loginAs(page, ADMIN, '/admin/users');
  await page.getByRole('searchbox', { name: 'Search by name or email' }).fill(user.email);
  await page.getByRole('button', { name: `Actions for ${user.name}` }).click();
  await page.getByRole('menuitem', { name: 'Reset 2FA' }).click();
  await page.getByRole('dialog', { name: 'Reset two-factor authentication?' }).getByRole('button', { name: 'Reset 2FA' }).click();
  await expect(page.getByText(`Two-factor authentication reset for ${user.email}`)).toBeVisible();

  // The password alone signs in again.
  const fresh = await Api.anonymous();
  const me = await fresh.login(user.email, user.password);
  expect(me.two_factor_required).toBeFalsy();
  expect(me.email).toBe(user.email);
  await fresh.dispose();
});
