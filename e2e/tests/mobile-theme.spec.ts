import { test, expect, loginAs } from '../lib/fixtures';
import { row } from '../lib/ui';
import type { Page } from '@playwright/test';

async function noHorizontalOverflow(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, 'page scrolls sideways').toBeLessThanOrEqual(client);
}

test.describe('phone (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('drawer navigation, upload from the FAB, no horizontal overflow', async ({ page, user, userApi }) => {
    const ws = await userApi.personal();
    await userApi.mkdir(ws.id, 'A folder with a rather long name that should wrap or truncate nicely');
    await loginAs(page, user);
    await expect(page.getByRole('heading', { name: 'My files', level: 1 })).toBeVisible();
    await noHorizontalOverflow(page);

    // Bottom tabs.
    const tabs = page.getByRole('navigation', { name: 'Primary' });
    await tabs.getByRole('link', { name: 'Recent' }).click();
    await expect(page).toHaveURL(/\/recent$/);
    await noHorizontalOverflow(page);

    // The drawer has the full navigation.
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByRole('dialog', { name: 'Main navigation' });
    await drawer.getByRole('link', { name: 'Trash' }).click();
    await expect(page).toHaveURL(/\/trash$/);
    await expect(drawer).toHaveCount(0);
    await noHorizontalOverflow(page);

    // Upload through the floating button.
    await tabs.getByRole('link', { name: 'Files' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload or create' }).click();
    await page.getByRole('menuitem', { name: 'Upload files' }).click();
    await (await chooser).setFiles({ name: 'from-phone.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
    await expect(row(page, 'from-phone.txt')).toBeVisible();
    await noHorizontalOverflow(page);

    // With a team, Trash shows a workspace picker next to "Empty trash"; the
    // actions wrap below the title instead of squeezing it to "T…".
    await userApi.createTeam('Team for trash');
    const junk = await userApi.upload(ws.id, 'junk.txt', 'x');
    await userApi.json('DELETE', `/api/nodes/${junk.id}`);
    await page.goto('/trash');
    await expect(page.getByRole('combobox', { name: 'Workspace' })).toBeVisible();
    const title = page.getByRole('heading', { name: 'Trash', level: 1 });
    expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    for (const path of ['/shared', '/account', '/teams']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await noHorizontalOverflow(page);
    }
  });
});

test('theme: System, Light and Dark persist across reloads', async ({ page, user }) => {
  await loginAs(page, user);
  const html = page.locator('html');
  const pick = async (label: 'System' | 'Light' | 'Dark') => {
    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('menuitemradio', { name: label }).click();
  };

  await page.emulateMedia({ colorScheme: 'dark' });
  await pick('Light');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');

  await pick('Dark');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');

  // System follows the OS, live.
  await pick('System');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Theme' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
});
