import { test, expect, loginAs } from '../lib/fixtures';
import { expectToast, itemAction, listedNames, listing, row } from '../lib/ui';

test('new folder, rename with F2, move, copy', async ({ page, user, userApi }) => {
  const ws = await userApi.personal();
  await userApi.upload(ws.id, 'report.txt', 'quarterly numbers', undefined, 'text/plain');
  await userApi.mkdir(ws.id, 'Archive');
  await loginAs(page, user);

  // New folder.
  await page.getByRole('button', { name: 'New folder' }).click();
  const dialog = page.getByRole('dialog', { name: 'New folder' });
  await dialog.getByRole('textbox', { name: 'Folder name' }).fill('Projects');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(row(page, 'Projects')).toBeVisible();

  // Rename with F2 on the selected row.
  await row(page, 'report.txt').click();
  await page.keyboard.press('F2');
  const rename = page.getByRole('dialog', { name: 'Rename' });
  await rename.getByRole('textbox', { name: 'File name' }).fill('report-2026.txt');
  await rename.getByRole('button', { name: 'Rename' }).click();
  await expect(row(page, 'report-2026.txt')).toBeVisible();
  await expect(row(page, 'report.txt')).toHaveCount(0);

  // Move into Projects.
  await itemAction(page, 'report-2026.txt', 'Move to…');
  const move = page.getByRole('dialog', { name: 'Move “report-2026.txt”' });
  await move.getByRole('button', { name: 'Projects' }).click();
  await move.getByRole('button', { name: 'Move here' }).click();
  await expectToast(page, 'Moved 1 item');
  await expect(row(page, 'report-2026.txt')).toHaveCount(0);

  // Copy it from Projects into Archive.
  await row(page, 'Projects').dblclick();
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  await itemAction(page, 'report-2026.txt', 'Copy to…');
  const copy = page.getByRole('dialog', { name: 'Copy “report-2026.txt”' });
  await copy.getByRole('button', { name: 'My files' }).click();
  await copy.getByRole('button', { name: 'Archive' }).click();
  await copy.getByRole('button', { name: 'Copy here' }).click();
  await expectToast(page, 'Copied 1 item');
  await expect(row(page, 'report-2026.txt')).toBeVisible();

  const archive = (await userApi.list(ws.id)).find((n) => n.name === 'Archive')!;
  expect((await userApi.list(ws.id, archive.id)).map((n) => n.name)).toEqual(['report-2026.txt']);
});

test('delete with undo, then trash restore and purge', async ({ page, user, userApi }) => {
  const ws = await userApi.personal();
  await userApi.upload(ws.id, 'keep.txt', 'keep me');
  await userApi.upload(ws.id, 'gone.txt', 'delete me');
  await userApi.upload(ws.id, 'back.txt', 'bring me back');
  await loginAs(page, user);

  // Delete key + confirm, then Undo from the toast.
  await row(page, 'keep.txt').click();
  await page.keyboard.press('Delete');
  await page.getByRole('dialog', { name: 'Move to trash?' }).getByRole('button', { name: 'Move to trash' }).click();
  await expect(row(page, 'keep.txt')).toHaveCount(0);
  await page.getByRole('status').filter({ hasText: 'Moved “keep.txt” to trash' }).getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'keep.txt')).toBeVisible();

  // Trash two items from the ⋯ menu.
  for (const name of ['gone.txt', 'back.txt']) {
    await itemAction(page, name, 'Move to trash');
    await page.getByRole('dialog', { name: 'Move to trash?' }).getByRole('button', { name: 'Move to trash' }).click();
    await expect(row(page, name)).toHaveCount(0);
  }

  await page.getByRole('link', { name: 'Trash' }).click();
  await expect(page).toHaveURL(/\/trash/);
  await row(page, 'back.txt').hover();
  await page.getByRole('button', { name: 'Restore back.txt' }).click();
  await expect(page.getByRole('button', { name: 'Restore back.txt' })).toHaveCount(0);
  await row(page, 'gone.txt').hover();
  await page.getByRole('button', { name: 'Delete gone.txt forever' }).click();
  await page.getByRole('dialog', { name: 'Delete forever?' }).getByRole('button', { name: 'Delete forever' }).click();
  await expect(page.getByText('Trash is empty')).toBeVisible();

  const names = (await userApi.list(ws.id)).map((n) => n.name).sort();
  expect(names).toEqual(['back.txt', 'keep.txt']);
});

test('empty folder state', async ({ page, user, userApi }) => {
  const ws = await userApi.personal();
  const f = await userApi.mkdir(ws.id, 'Nothing here yet');
  await loginAs(page, user, `/w/${ws.id}/f/${f.id}`);
  await expect(page.getByRole('heading', { name: 'Nothing here yet', level: 1 })).toBeVisible();
  await expect(page.getByText('This folder is empty')).toBeVisible();
});

test('sort by columns and switch layouts', async ({ page, user, userApi }) => {
  const ws = await userApi.personal();
  // Different sizes and upload times: b is newest, c is biggest.
  await userApi.upload(ws.id, 'a-small.txt', 'a');
  await userApi.upload(ws.id, 'c-big.txt', 'c'.repeat(5000));
  await new Promise((r) => setTimeout(r, 1100));
  await userApi.upload(ws.id, 'b-medium.txt', 'b'.repeat(100));
  await loginAs(page, user);

  await expect(row(page, 'b-medium.txt')).toBeVisible();
  expect(await listedNames(page)).toEqual(['a-small.txt', 'b-medium.txt', 'c-big.txt']);
  await page.getByRole('button', { name: 'Name' }).click();
  await expect.poll(() => listedNames(page)).toEqual(['c-big.txt', 'b-medium.txt', 'a-small.txt']);
  await page.getByRole('button', { name: 'Size' }).click();
  const bySize = await listedNames(page);
  expect([bySize[0], bySize[2]].sort()).toEqual(['a-small.txt', 'c-big.txt']);
  await page.getByRole('button', { name: 'Size' }).click();
  expect((await listedNames(page)).reverse()).toEqual(bySize);
  await page.getByRole('button', { name: 'Modified' }).click();
  const byDate = await listedNames(page);
  expect(byDate[0] === 'b-medium.txt' || byDate[2] === 'b-medium.txt').toBeTruthy();

  const layout = page.getByRole('radiogroup', { name: 'Layout' });
  for (const view of ['Details', 'Tiles', 'Gallery', 'List'] as const) {
    await layout.getByRole('radio', { name: view }).click();
    await expect(layout.getByRole('radio', { name: view })).toBeChecked();
    await expect(listing(page)).toBeVisible();
    await expect(row(page, 'b-medium.txt')).toBeVisible();
  }
  // The choice sticks across reloads.
  await layout.getByRole('radio', { name: 'Tiles' }).click();
  await page.reload();
  await expect(page.getByRole('radiogroup', { name: 'Layout' }).getByRole('radio', { name: 'Tiles' })).toBeChecked();
});

test('search with Ctrl/Cmd+K by name and by content', async ({ page, user, userApi }) => {
  const ws = await userApi.personal();
  const f = await userApi.mkdir(ws.id, 'Deep');
  await userApi.upload(ws.id, 'invoice-zebra.txt', 'nothing special', f.id, 'text/plain');
  await userApi.upload(ws.id, 'minutes.md', '# Minutes\nWe discussed the flamingo migration plan.', undefined, 'text/markdown');
  await loginAs(page, user);
  await expect(row(page, 'minutes.md')).toBeVisible();

  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+k`);
  const palette = page.getByRole('dialog', { name: 'Search' });
  const box = palette.getByRole('combobox');
  await box.fill('zebra');
  await expect(palette.getByRole('option', { name: /invoice-zebra\.txt/ })).toBeVisible();
  await box.fill('flamingo');
  await expect(palette.getByRole('option', { name: /minutes\.md/ })).toBeVisible();
  await palette.getByRole('option', { name: /See all results/ }).click();
  await expect(page).toHaveURL(/\/search\?q=flamingo/);
  await expect(page.getByText('minutes.md').first()).toBeVisible();
});
