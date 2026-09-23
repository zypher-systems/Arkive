import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, expect, loginAs } from '../lib/fixtures';
import { Api, newUser } from '../lib/api';
import { ADMIN, uniq } from '../lib/env';
import { gradientPng } from '../lib/png';
import { itemAction, row } from '../lib/ui';
import type { Page } from '@playwright/test';

// Screenshots of the main screens against the real backend (not mocks), with
// the kind of data real instances have: long names, many files, real
// thumbnails, empty states and errors. Not part of the regular suite:
//   ARKIVE_E2E_SCREENS=/tmp/shots npx playwright test --project=screens

const OUT = process.env.ARKIVE_E2E_SCREENS || 'screens';

const LONG = 'Quarterly board meeting notes — final revised version with appendix and comments from legal (do not distribute).docx';
const PALETTE: [number, number, number][] = [
  [228, 126, 70],
  [80, 140, 200],
  [60, 170, 120],
  [200, 80, 140],
  [240, 200, 90],
  [120, 90, 200],
];

async function seed(api: Api) {
  const ws = await api.personal();
  const photos = await api.mkdir(ws.id, 'Photos 2026 — Lisbon, Porto and the Algarve coast road trip');
  await api.mkdir(ws.id, 'Projects');
  await api.mkdir(ws.id, 'Receipts');
  const empty = await api.mkdir(ws.id, 'Empty folder');
  for (let i = 0; i < 12; i++) {
    const a = PALETTE[i % PALETTE.length];
    const b = PALETTE[(i + 2) % PALETTE.length];
    await api.upload(ws.id, `IMG_${2040 + i}.png`, gradientPng(480, 320, a, b), photos.id, 'image/png');
  }
  await api.upload(ws.id, 'Logo.png', gradientPng(256, 256, [30, 30, 40], [230, 120, 60]), undefined, 'image/png');
  await api.upload(ws.id, LONG, Buffer.alloc(48_000, 1), undefined, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  await api.upload(ws.id, 'README.md', '# Arkive\n\nSelf-hosted files.\n\n- WebDAV\n- Sharing\n- Versions\n', undefined, 'text/markdown');
  for (let i = 1; i <= 40; i++) {
    const ext = ['txt', 'pdf', 'csv', 'json', 'zip', 'mp3'][i % 6];
    await api.upload(ws.id, `Report ${String(i).padStart(2, '0')}.${ext}`, 'x'.repeat(100 * i), undefined, 'application/octet-stream');
  }
  const gone = await api.upload(ws.id, 'Old draft with a long name that was deleted last week.txt', 'old');
  await api.json('DELETE', `/api/nodes/${gone.id}`);
  return { ws, photos, empty };
}

async function shoot(page: Page, name: string) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${name}: horizontal overflow`).toBeLessThanOrEqual(0);
}

for (const variant of ['light', 'dark', 'mobile'] as const) {
  test.describe(variant, () => {
    test.use(
      variant === 'mobile'
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'light' }
        : { viewport: { width: 1440, height: 900 }, colorScheme: variant },
    );

    test(`screens (${variant})`, async ({ page, openAs }) => {
      test.setTimeout(180_000);
      const user = await newUser('shots');
      const api = await Api.as(user);
      const { ws, photos, empty } = await seed(api);
      const friend = await newUser('friend');
      const friendApi = await Api.as(friend);
      const fws = await friendApi.personal();
      const shared = await friendApi.mkdir(fws.id, 'Shared from a friend with a very long folder name indeed');
      await friendApi.share(shared.id, { grantee_email: user.email, permission: 'write' });
      const team = await api.createTeam(uniq('Design team'));
      const link = await api.json<{ token: string }>('POST', `/api/nodes/${photos.id}/links`, {});

      await loginAs(page, user);
      await expect(row(page, 'Projects')).toBeVisible();
      await shoot(page, `${variant}-files-list`);
      await page.goto(`/w/${ws.id}/f/${photos.id}`);
      await expect(row(page, 'IMG_2040.png')).toBeVisible();
      if (variant !== 'mobile') {
        await page.getByRole('radiogroup', { name: 'Layout' }).getByRole('radio', { name: 'Gallery' }).click();
        await shoot(page, `${variant}-files-gallery`);
        await page.getByRole('radiogroup', { name: 'Layout' }).getByRole('radio', { name: 'Tiles' }).click();
        await shoot(page, `${variant}-files-tiles`);
        await page.getByRole('radiogroup', { name: 'Layout' }).getByRole('radio', { name: 'Details' }).click();
        await page.goto(`/w/${ws.id}`);
        await itemAction(page, LONG, 'Details');
        await expect(page.getByRole('complementary', { name: 'Details' })).toBeVisible();
        await shoot(page, `${variant}-files-details`);
        await page.goto(`/w/${ws.id}`);
        await page.getByRole('radiogroup', { name: 'Layout' }).getByRole('radio', { name: 'List' }).click();
      } else {
        await shoot(page, `${variant}-photos`);
      }
      await page.goto(`/w/${ws.id}/f/${empty.id}`);
      await expect(page.getByText('This folder is empty')).toBeVisible();
      await shoot(page, `${variant}-empty-folder`);
      await page.goto(`/w/${ws.id}/f/00000000-0000-4000-8000-000000000000`);
      await expect(page.getByText('This folder isn’t available')).toBeVisible();
      await shoot(page, `${variant}-folder-missing`);
      await page.goto('/shared');
      await shoot(page, `${variant}-shared`);
      await page.goto('/trash');
      await shoot(page, `${variant}-trash`);
      await page.goto('/search?q=report');
      await shoot(page, `${variant}-search`);
      await page.goto('/recent');
      await shoot(page, `${variant}-recent`);
      await page.goto('/teams');
      await expect(page.getByText(team.name).last()).toBeVisible();
      await shoot(page, `${variant}-teams`);
      await page.goto('/account/security');
      await shoot(page, `${variant}-account-security`);
      await page.goto('/account/webdav');
      await shoot(page, `${variant}-account-webdav`);
      await page.goto(`/w/${ws.id}`);
      await row(page, 'README.md').dblclick();
      await expect(page.getByRole('dialog', { name: 'Editing README.md' })).toBeVisible();
      await shoot(page, `${variant}-editor`);

      const admin = await openAs(ADMIN, '/admin/users');
      await admin.setViewportSize(page.viewportSize()!);
      await admin.emulateMedia({ colorScheme: variant === 'dark' ? 'dark' : 'light' });
      await shoot(admin, `${variant}-admin-users`);
      await admin.goto('/admin/audit');
      await shoot(admin, `${variant}-admin-audit`);
      await admin.goto('/admin/storage');
      await shoot(admin, `${variant}-admin-storage`);

      const anon = await openAs(null, `/s/${link.token}`);
      await anon.setViewportSize(page.viewportSize()!);
      await anon.emulateMedia({ colorScheme: variant === 'dark' ? 'dark' : 'light' });
      await expect(anon.getByText('IMG_2040.png')).toBeVisible();
      await shoot(anon, `${variant}-public-folder`);
      await anon.goto('/s/does-not-exist');
      await shoot(anon, `${variant}-public-missing`);
      await api.dispose();
      await friendApi.dispose();
    });
  });
}
