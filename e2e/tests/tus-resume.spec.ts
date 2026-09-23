import * as fs from 'node:fs';
import { test, expect, loginAs } from '../lib/fixtures';
import { MiB, bytes, sha256, writeTree } from '../lib/files';
import { row } from '../lib/ui';

test('an interrupted tus upload resumes after a reload', async ({ context, page, user, userApi }) => {
  const data = bytes(20 * MiB); // three 8 MiB chunks
  const file = `${writeTree({ 'resume.bin': data })}/resume.bin`;
  await loginAs(page, user);

  // Let the first chunk through, then stall the second one and close the tab.
  let patches = 0;
  await page.route(/\/api\/uploads\/[^/]+$/, async (route) => {
    if (route.request().method() === 'PATCH' && ++patches > 1) return; // never answered
    await route.continue();
  });
  const firstChunk = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.status() === 204);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Upload files' }).click();
  await (await chooser).setFiles(file);
  await firstChunk;
  await expect.poll(() => patches).toBe(2);
  await page.close({ runBeforeUnload: false });

  // A new tab (same browser profile) offers to resume it.
  const tab = await context.newPage();
  const offsets: string[] = [];
  tab.on('request', (r) => {
    if (r.method() === 'PATCH' && r.url().includes('/api/uploads/')) offsets.push(r.headers()['upload-offset']);
  });
  await tab.goto('/');
  const panel = tab.getByRole('region', { name: 'Uploads' });
  await expect(panel.getByText('1 interrupted upload')).toBeVisible();
  await expect(panel.getByText('resume.bin')).toBeVisible();
  const again = tab.waitForEvent('filechooser');
  await panel.getByRole('button', { name: 'Resume', exact: true }).click();
  await (await again).setFiles(file);
  await expect(panel.getByText('1 upload complete')).toBeVisible({ timeout: 30_000 });
  await expect(row(tab, 'resume.bin')).toBeVisible();

  // It continued from the server's offset (at least the first chunk; tus
  // keeps whatever part of the stalled chunk arrived) instead of starting over.
  expect(Number(offsets[0])).toBeGreaterThanOrEqual(8 * MiB);
  expect(Number(offsets[0])).toBeLessThan(20 * MiB);
  const ws = await userApi.personal();
  const node = (await userApi.list(ws.id)).find((n) => n.name === 'resume.bin')!;
  expect(node, 'uploaded node').toBeTruthy();
  expect(sha256(await userApi.download(node.id))).toBe(sha256(fs.readFileSync(file)));
});
