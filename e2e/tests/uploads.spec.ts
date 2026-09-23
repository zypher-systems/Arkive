import { test, expect, loginAs } from '../lib/fixtures';
import { MiB, bytes, sha256, writeTree } from '../lib/files';
import { row } from '../lib/ui';
import type { Page } from '@playwright/test';

async function pickFiles(page: Page, entry: 'Upload files' | 'Upload folder', files: Parameters<import('@playwright/test').FileChooser['setFiles']>[0]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByRole('menuitem', { name: entry }).click();
  await (await chooser).setFiles(files);
}

const panel = (page: Page) => page.getByRole('region', { name: 'Uploads' });

test('small file uses a single PUT', async ({ page, user, userApi }) => {
  await loginAs(page, user);
  const puts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().includes('/upload?')) puts.push(r.url());
  });
  await pickFiles(page, 'Upload files', { name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('hello world') });
  await expect(row(page, 'hello.txt')).toBeVisible();
  await expect(panel(page).getByText('1 upload complete')).toBeVisible();
  expect(puts).toHaveLength(1);
  const ws = await userApi.personal();
  const node = (await userApi.list(ws.id)).find((n) => n.name === 'hello.txt')!;
  expect((await userApi.download(node.id)).toString()).toBe('hello world');
});

test('a file over 8 MiB goes through tus', async ({ page, user, userApi }) => {
  await loginAs(page, user);
  const tus: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/uploads')) tus.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  const data = bytes(9 * MiB);
  await pickFiles(page, 'Upload files', { name: 'big.bin', mimeType: 'application/octet-stream', buffer: data });
  await expect(row(page, 'big.bin')).toBeVisible({ timeout: 30_000 });
  expect(tus).toContain('POST /api/uploads');
  expect(tus.filter((t) => t.startsWith('PATCH /api/uploads/')).length).toBeGreaterThanOrEqual(2);
  const ws = await userApi.personal();
  const node = (await userApi.list(ws.id)).find((n) => n.name === 'big.bin')!;
  expect(sha256(await userApi.download(node.id))).toBe(sha256(data));
});

test('folder upload keeps the structure', async ({ page, user, userApi }) => {
  const root = writeTree({
    'Trip/notes.txt': 'day one',
    'Trip/photos/a.txt': 'a',
    'Trip/photos/raw/b.txt': 'b',
  });
  await loginAs(page, user);
  await pickFiles(page, 'Upload folder', `${root}/Trip`);
  await expect(row(page, 'Trip')).toBeVisible();
  await expect(panel(page).getByText('3 uploads complete')).toBeVisible();

  const ws = await userApi.personal();
  const trip = (await userApi.list(ws.id)).find((n) => n.name === 'Trip')!;
  const inTrip = await userApi.list(ws.id, trip.id);
  expect(inTrip.map((n) => n.name).sort()).toEqual(['notes.txt', 'photos']);
  const photos = inTrip.find((n) => n.name === 'photos')!;
  const inPhotos = await userApi.list(ws.id, photos.id);
  expect(inPhotos.map((n) => n.name).sort()).toEqual(['a.txt', 'raw']);
  const raw = inPhotos.find((n) => n.name === 'raw')!;
  expect((await userApi.list(ws.id, raw.id)).map((n) => n.name)).toEqual(['b.txt']);
});

test('one failing file does not stop the batch; retry works', async ({ page, user }) => {
  await loginAs(page, user);
  let failures = 1;
  await page.route(/\/upload\?.*name=broken\.txt/, async (route) => {
    if (failures-- > 0) {
      await route.fulfill({ status: 413, contentType: 'application/json', body: '{"error":"storage quota exceeded"}' });
    } else {
      await route.continue();
    }
  });
  await pickFiles(page, 'Upload files', [
    { name: 'one.txt', mimeType: 'text/plain', buffer: Buffer.from('1') },
    { name: 'broken.txt', mimeType: 'text/plain', buffer: Buffer.from('2') },
    { name: 'three.txt', mimeType: 'text/plain', buffer: Buffer.from('3') },
  ]);
  await expect(panel(page).getByText('1 upload failed')).toBeVisible();
  await expect(panel(page).getByText('storage quota exceeded')).toBeVisible();
  await expect(row(page, 'one.txt')).toBeVisible();
  await expect(row(page, 'three.txt')).toBeVisible();
  await expect(row(page, 'broken.txt')).toHaveCount(0);

  await panel(page).getByRole('button', { name: 'Retry upload of broken.txt' }).click();
  await expect(row(page, 'broken.txt')).toBeVisible();
});

test('cancel a running upload', async ({ page, user, userApi }) => {
  await loginAs(page, user);
  // Hold every PATCH so the transfer is reliably in flight when we cancel.
  await page.route(/\/api\/uploads\/[^/]+$/, async (route) => {
    if (route.request().method() === 'PATCH') {
      await new Promise((r) => setTimeout(r, 30_000));
      await route.continue().catch(() => undefined);
    } else {
      await route.continue();
    }
  });
  const deleted = page.waitForRequest((r) => r.method() === 'DELETE' && /\/api\/uploads\//.test(r.url()));
  await pickFiles(page, 'Upload files', { name: 'slow.bin', mimeType: 'application/octet-stream', buffer: bytes(9 * MiB) });
  const cancel = panel(page).getByRole('button', { name: 'Cancel upload of slow.bin' });
  await expect(cancel).toBeVisible();
  await page.waitForRequest((r) => r.method() === 'PATCH');
  await cancel.click();
  await expect(panel(page).getByText('Canceled')).toBeVisible();
  // The partial session is terminated server side (tus DELETE).
  await deleted;
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const ws = await userApi.personal();
  expect((await userApi.list(ws.id)).map((n) => n.name)).not.toContain('slow.bin');
});
