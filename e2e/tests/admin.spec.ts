import { test, expect, loginAs } from '../lib/fixtures';
import { ADMIN } from '../lib/env';

const TABS = [
  ['Users', 'Users'],
  ['Storage', 'Storage backends'],
  ['Sign-in', 'Registration'],
  ['Email', 'Outgoing email (SMTP)'],
  ['Integrations', 'Google Drive'],
  ['Maintenance', 'Trash retention'],
  ['Audit log', 'Audit log'],
] as const;

test('every admin tab loads', async ({ page }) => {
  await loginAs(page, ADMIN, '/admin');
  const nav = page.getByRole('navigation', { name: 'Admin sections' });
  for (const [tab, heading] of TABS) {
    await nav.getByRole('link', { name: tab }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
    await expect(page.getByText('Couldn’t load admin settings')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
});

test('version retention change is saved and audited; audit filters work', async ({ page, adminApi }) => {
  const before = await adminApi.get<{ max_versions: number }>('/api/admin/settings/versions');
  const next = before.max_versions === 9 ? 8 : 9;
  try {
    await loginAs(page, ADMIN, '/admin/maintenance');
    const section = page.getByRole('region', { name: 'Version history' });
    const input = section.getByRole('spinbutton', { name: 'Versions to keep (0–100)' });
    await expect(input).toHaveValue(String(before.max_versions));
    await input.fill(String(next));
    await section.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(`Keeping ${next} previous versions`)).toBeVisible();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Version history' }).getByRole('spinbutton')).toHaveValue(String(next));

    await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Audit log' }).click();
    const audit = page.getByRole('region', { name: 'Audit log' });
    await audit.getByRole('combobox', { name: 'Action' }).selectOption({ label: 'Settings' });
    await expect(audit.getByText('Updated settings').first()).toBeVisible();
    await expect(audit.getByText('Signed in')).toHaveCount(0);

    await audit.getByRole('combobox', { name: 'Action' }).selectOption({ label: 'Sign-in & security' });
    await audit.getByRole('combobox', { name: 'Actor' }).selectOption({ label: ADMIN.email });
    await expect(audit.getByText('Signed in').first()).toBeVisible();
    await expect(audit.getByText('Updated settings')).toHaveCount(0);
  } finally {
    await adminApi.json('PUT', '/api/admin/settings/versions', { max_versions: before.max_versions });
  }
});
