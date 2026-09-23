import * as fs from 'node:fs';
import { test, expect, loginAs } from '../lib/fixtures';
import { expectToast, row } from '../lib/ui';
import type { Page } from '@playwright/test';

async function openSharing(page: Page, name: string) {
  await row(page, name).hover();
  await page.getByRole('button', { name: `Share ${name}`, exact: true }).click();
  const details = page.getByRole('complementary', { name: 'Details' });
  await expect(details.getByRole('tab', { name: 'Sharing', selected: true })).toBeVisible();
  return details;
}

function tomorrowLocal(): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

test('view link with password and expiry: anonymous unlock and download', async ({ page, user, userApi, openAs }) => {
  const ws = await userApi.personal();
  const file = await userApi.upload(ws.id, 'handout.txt', 'public handout contents', undefined, 'text/plain');
  // Non-ASCII passwords must work (HTTP headers are Latin-1).
  const password = 'Grüße ✓ 2026';
  await loginAs(page, user);

  const details = await openSharing(page, 'handout.txt');
  await details.getByRole('button', { name: 'New link' }).click();
  await details.getByLabel('Password').fill(password);
  await details.getByLabel('Expires').fill(tomorrowLocal());
  await details.getByRole('button', { name: 'Create & copy link' }).click();
  await expectToast(page, /Link created/);
  await expect(details.getByText('Password', { exact: true }).last()).toBeVisible();
  await expect(details.getByText(/^Expires /)).toBeVisible();

  const [link] = await userApi.links(file.id);
  expect(link.has_password).toBe(true);
  expect(link.expires_at).toBeTruthy();

  const anon = await openAs(null, `/s/${link.token}`);
  await expect(anon.getByRole('heading', { name: 'This link is protected' })).toBeVisible();
  await anon.getByLabel('Password').fill('not it');
  await anon.getByRole('button', { name: 'Continue' }).click();
  await expect(anon.getByText('That password isn’t right.')).toBeVisible();
  await anon.getByLabel('Password').fill(password);
  await anon.getByRole('button', { name: 'Continue' }).click();
  await expect(anon.getByRole('heading', { name: 'handout.txt' })).toBeVisible();
  await expect(anon.getByText('23 B')).toBeVisible(); // size comes from the link meta
  const download = anon.waitForEvent('download');
  await anon.getByRole('button', { name: 'Download' }).click();
  const dl = await download;
  expect(dl.suggestedFilename()).toBe('handout.txt');
  expect(fs.readFileSync(await dl.path()).toString()).toBe('public handout contents');
});

test('upload-only link: anonymous drops files, collisions are renamed, nothing is readable', async ({ page, user, userApi, openAs }) => {
  const ws = await userApi.personal();
  const inbox = await userApi.mkdir(ws.id, 'Inbox');
  await userApi.upload(ws.id, 'report.txt', 'already here', inbox.id, 'text/plain');
  await loginAs(page, user);

  const details = await openSharing(page, 'Inbox');
  await details.getByRole('button', { name: 'New link' }).click();
  await details.getByRole('radio', { name: 'Upload only' }).click();
  await details.getByRole('button', { name: 'Create & copy link' }).click();
  await expectToast(page, /Link created/);
  await expect(details.getByText('Upload-only link (file request)')).toBeVisible();
  const [link] = await userApi.links(inbox.id);
  expect(link.mode).toBe('upload');

  const anon = await openAs(null, `/s/${link.token}`);
  await expect(anon.getByRole('heading', { name: 'Send files to “Inbox”' })).toBeVisible();
  const chooser = anon.waitForEvent('filechooser');
  await anon.getByRole('button', { name: 'Choose files' }).click();
  await (await chooser).setFiles([
    { name: 'report.txt', mimeType: 'text/plain', buffer: Buffer.from('from a stranger') },
    { name: 'photo.txt', mimeType: 'text/plain', buffer: Buffer.from('second file') },
  ]);
  const sent = anon.getByRole('region', { name: 'Uploads' });
  await expect(sent.getByText('2 files sent')).toBeVisible();
  await expect(sent.getByText('Delivered as report (1).txt')).toBeVisible();

  // The owner has both; the original is untouched.
  const names = (await userApi.list(ws.id, inbox.id)).map((n) => n.name).sort();
  expect(names).toEqual(['photo.txt', 'report (1).txt', 'report.txt']);
  const original = (await userApi.list(ws.id, inbox.id)).find((n) => n.name === 'report.txt')!;
  expect((await userApi.download(original.id)).toString()).toBe('already here');

  // View endpoints are closed for upload links.
  for (const path of ['', '/nodes', '/download']) {
    const res = await anon.request.get(`/api/public/${link.token}${path}`);
    if (path === '') {
      expect(res.status()).toBe(200);
      expect((await res.json()).mode).toBe('upload');
    } else {
      expect(res.status(), `GET ${path}`).toBe(403);
    }
  }
  const zip = await anon.request.post(`/api/public/${link.token}/download-zip`, { data: { node_ids: [] } });
  expect(zip.status()).toBe(403);

  // The owner sees the drop in Recent.
  await page.getByRole('link', { name: 'Recent' }).click();
  await expect(page.getByText('File received via upload link').first()).toBeVisible();
});
