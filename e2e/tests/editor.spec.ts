import { test, expect, loginAs } from '../lib/fixtures';
import { expectToast, itemAction, row } from '../lib/ui';

test('edit markdown, save with Ctrl+S, versions and restore', async ({ page, user, userApi }) => {
  const ws = await userApi.personal();
  const node = await userApi.upload(ws.id, 'plan.md', '# Plan\nfirst draft\n', undefined, 'text/markdown');
  await loginAs(page, user);

  await row(page, 'plan.md').dblclick();
  const editor = page.getByRole('dialog', { name: 'Editing plan.md' });
  const content = editor.getByRole('textbox', { name: 'File content' });
  await expect(content).toHaveValue('# Plan\nfirst draft\n');
  await content.fill('# Plan\nsecond draft\n');
  await expect(editor.getByText('Unsaved changes')).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
  await expect(editor.getByText(/^Saved /)).toBeVisible();
  await expect(editor.getByText('Unsaved changes')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Close editor' }).click();
  await expect(editor).toHaveCount(0);

  // The new content survives a reload.
  await page.reload();
  await row(page, 'plan.md').dblclick();
  await expect(page.getByRole('dialog', { name: 'Editing plan.md' }).getByRole('textbox', { name: 'File content' })).toHaveValue(
    '# Plan\nsecond draft\n',
  );
  await page.getByRole('button', { name: 'Close editor' }).click();

  // The first draft is version 1 in Version history; restoring it brings it back.
  await itemAction(page, 'plan.md', 'Version history');
  const details = page.getByRole('complementary', { name: 'Details' });
  await expect(details.getByRole('tab', { name: 'Versions', selected: true })).toBeVisible();
  await details.getByRole('button', { name: 'Restore version 1' }).click();
  await page.getByRole('dialog', { name: 'Restore this version?' }).getByRole('button', { name: 'Restore' }).click();
  await expectToast(page, 'Restored version 1');
  expect((await userApi.download(node.id)).toString()).toBe('# Plan\nfirst draft\n');
  // The content that was current is kept as a new version.
  await expect(details.getByRole('button', { name: 'Restore version 2' })).toBeVisible();
});

test('a text file over 2 MB opens read-only and truncated', async ({ page, user, userApi }) => {
  const ws = await userApi.personal();
  const big = 'line of text\n'.repeat(Math.ceil((2.5 * 1024 * 1024) / 13));
  await userApi.upload(ws.id, 'huge.log.txt', big, undefined, 'text/plain');
  await loginAs(page, user);
  await row(page, 'huge.log.txt').dblclick();
  const editor = page.getByRole('dialog', { name: 'Editing huge.log.txt' });
  await expect(editor.getByText('This file is larger than 2 MB, so it opens read-only (truncated).', { exact: false })).toBeVisible();
  await expect(editor.getByRole('textbox', { name: 'File content' })).toHaveAttribute('readonly', '');
  await expect(editor.getByText('Couldn’t open this file')).toHaveCount(0);
});
