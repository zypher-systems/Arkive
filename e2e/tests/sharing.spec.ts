import { test, expect, loginAs } from '../lib/fixtures';
import { Api, newUser } from '../lib/api';
import { uniq } from '../lib/env';
import { expectToast, itemAction, row } from '../lib/ui';
import type { Page } from '@playwright/test';

async function shareFromDetails(page: Page, name: string, fill: (panel: import('@playwright/test').Locator) => Promise<void>) {
  await row(page, name).hover();
  await page.getByRole('button', { name: `Share ${name}`, exact: true }).click();
  const details = page.getByRole('complementary', { name: 'Details' });
  await expect(details.getByRole('tab', { name: 'Sharing', selected: true })).toBeVisible();
  await fill(details);
  await details.getByRole('button', { name: 'Share', exact: true }).click();
  await expectToast(page, 'Shared');
  return details;
}

test('read share: the grantee sees it under Shared with me and cannot write', async ({ page, openAs, user, userApi }) => {
  const reader = await newUser('reader');
  const ws = await userApi.personal();
  const folder = await userApi.mkdir(ws.id, 'Board papers');
  await userApi.upload(ws.id, 'minutes.txt', 'confidential', folder.id, 'text/plain');
  await loginAs(page, user);

  const details = await shareFromDetails(page, 'Board papers', async (panel) => {
    await panel.getByRole('textbox', { name: 'Email address' }).fill(reader.email);
    await panel.getByRole('combobox', { name: 'Permission' }).selectOption({ label: 'Can view' });
  });
  await expect(details.getByText(reader.email)).toBeVisible();

  const other = await openAs(reader, '/shared');
  await expect(other.getByRole('heading', { name: 'Shared with me', level: 1 })).toBeVisible();
  await expect(row(other, 'Board papers')).toBeVisible();
  await row(other, 'Board papers').dblclick();
  await expect(other.getByRole('heading', { name: 'Board papers', level: 1 })).toBeVisible();
  await expect(row(other, 'minutes.txt')).toBeVisible();
  await expect(other.getByText('View only')).toBeVisible();
  await expect(other.getByRole('button', { name: 'New folder' })).toHaveCount(0);

  // The API agrees: no writes into a read share.
  const readerApi = await Api.as(reader);
  const res = await readerApi.ctx.put(`/api/workspaces/${ws.id}/upload?name=x.txt&parent_id=${folder.id}`, { data: 'x' });
  expect(res.status()).toBe(403);
  await readerApi.dispose();
});

test('write share: the grantee creates and moves files inside the shared folder', async ({ page, openAs, user, userApi }) => {
  const writer = await newUser('writer');
  const ws = await userApi.personal();
  const folder = await userApi.mkdir(ws.id, 'Drafts');
  await userApi.mkdir(ws.id, 'Final', folder.id);
  await userApi.upload(ws.id, 'essay.txt', 'v1', folder.id, 'text/plain');
  await userApi.share(folder.id, { grantee_email: writer.email, permission: 'write' });

  const other = await openAs(writer, '/shared');
  await row(other, 'Drafts').dblclick();
  await expect(other.getByText('Can edit')).toBeVisible();
  await other.getByRole('button', { name: 'New folder' }).click();
  const dialog = other.getByRole('dialog', { name: 'New folder' });
  await dialog.getByRole('textbox', { name: 'Folder name' }).fill('From writer');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(row(other, 'From writer')).toBeVisible();

  // Move to… starts at the shared folder (not the owner's root).
  await itemAction(other, 'essay.txt', 'Move to…');
  const move = other.getByRole('dialog', { name: 'Move “essay.txt”' });
  await move.getByRole('button', { name: 'Final' }).click();
  await move.getByRole('button', { name: 'Move here' }).click();
  await expectToast(other, 'Moved 1 item');
  await expect(row(other, 'essay.txt')).toHaveCount(0);

  const final = (await userApi.list(ws.id, folder.id)).find((n) => n.name === 'Final')!;
  expect((await userApi.list(ws.id, final.id)).map((n) => n.name)).toEqual(['essay.txt']);
  expect((await userApi.list(ws.id)).map((n) => n.name)).toEqual(['Drafts']);
});

test('team share: members of the team see the file', async ({ page, openAs, user, userApi }) => {
  const member = await newUser('member');
  const team = await userApi.createTeam(uniq('Design'));
  const memberApi = await Api.as(member);
  await memberApi.joinTeam(team.invite_token!);
  await memberApi.dispose();
  const ws = await userApi.personal();
  await userApi.upload(ws.id, 'brand.txt', 'colours', undefined, 'text/plain');
  await loginAs(page, user);

  await shareFromDetails(page, 'brand.txt', async (panel) => {
    await panel.getByRole('combobox', { name: 'Or share with a team…' }).selectOption({ label: team.name });
  });

  const other = await openAs(member, '/shared');
  await expect(row(other, 'brand.txt')).toBeVisible();
});
