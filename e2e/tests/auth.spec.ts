import { test, expect } from '../lib/fixtures';
import { ADMIN, uniq } from '../lib/env';

async function signIn(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('setup is done: /setup no longer offers first-run setup', async ({ page, request }) => {
  const res = await request.get('/api/setup');
  expect((await res.json()).needed).toBe(false);
  await page.goto('/setup');
  // The setup form refuses (or redirects) once an admin exists.
  await expect(page.getByRole('button', { name: 'Create admin account' })).toHaveCount(0, { timeout: 5000 }).catch(async () => {
    await expect(page.getByText('Setup has already been completed. Sign in instead.')).toBeVisible();
  });
});

test('login, logout and a wrong password', async ({ page, user }) => {
  await signIn(page, user.email, 'not-the-password');
  await expect(page.getByText('Incorrect email or password.')).toBeVisible();

  await page.getByRole('textbox', { name: 'Password' }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'My files', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: `Account menu for ${user.name}` }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  // The session is really gone: protected routes bounce back to login.
  await page.goto('/recent');
  await expect(page).toHaveURL(/\/login\?next=%2Frecent/);
});

test('registration waits for approval, admin approves in Admin → Users', async ({ page, openAs }) => {
  const name = uniq('signup');
  const email = `${name}@e2e.arkive.test`;
  await page.goto('/login');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill(`Signup ${name}`);
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill('signup-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Your account was created and is waiting for an admin to approve it.')).toBeVisible();

  // Pending accounts cannot sign in yet.
  await signIn(page, email, 'signup-password');
  await expect(page.getByText('Your account is waiting for admin approval.')).toBeVisible();

  const admin = await openAs(ADMIN, '/admin/users');
  const pending = admin.getByRole('region', { name: /pending approval/ });
  await expect(pending.getByText(email)).toBeVisible();
  await pending.getByRole('button', { name: `Approve ${email}` }).click();
  await expect(admin.getByText(`Approved ${email}`)).toBeVisible();

  await page.getByRole('textbox', { name: 'Password' }).fill('signup-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+$/);
});
