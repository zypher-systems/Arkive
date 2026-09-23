import { test, expect, loginAs } from '../lib/fixtures';
import { itemAction, row } from '../lib/ui';

test('WebDAV: PROPFIND, PUT/GET with ETags, locks, MOVE over an existing file', async ({ page, request, user, userApi }) => {
  const ws = await userApi.personal();
  const base = `/dav/${ws.id}`;
  const auth = { Authorization: `Basic ${Buffer.from(`${user.email}:${user.password}`).toString('base64')}` };
  const dav = (method: string, path: string, headers: Record<string, string> = {}, data?: string) =>
    request.fetch(`${base}${path}`, { method, headers: { ...auth, ...headers }, data, maxRedirects: 0 });

  // PUT creates, GET returns the body with an ETag.
  expect((await dav('PUT', '/notes.txt', { 'Content-Type': 'text/plain' }, 'first')).status()).toBe(201);
  const get = await dav('GET', '/notes.txt');
  expect(get.status()).toBe(200);
  expect(await get.text()).toBe('first');
  const etag = get.headers()['etag'];
  expect(etag).toBeTruthy();

  // Conditional requests.
  expect((await dav('GET', '/notes.txt', { 'If-None-Match': etag })).status()).toBe(304);
  expect((await dav('PUT', '/notes.txt', { 'If-Match': '"not-the-etag"' }, 'lost update')).status()).toBe(412);
  expect((await dav('PUT', '/notes.txt', { 'If-None-Match': '*' }, 'create only')).status()).toBe(412);
  expect((await dav('PUT', '/notes.txt', { 'If-Match': etag }, 'second')).status()).toBe(204);
  expect((await dav('GET', '/notes.txt', { 'If-None-Match': etag })).status()).toBe(200);

  // PROPFIND lists it.
  const list = await dav('PROPFIND', '/', { Depth: '1' });
  expect(list.status()).toBe(207);
  const xml = await list.text();
  expect(xml).toContain('notes.txt');
  expect(xml).toMatch(/getetag/i);

  // LOCK blocks writers without the token; UNLOCK releases it.
  const lockBody = `<?xml version="1.0" encoding="utf-8"?>
<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner>e2e</D:owner></D:lockinfo>`;
  const lock = await dav('LOCK', '/notes.txt', { 'Content-Type': 'application/xml', Timeout: 'Second-60' }, lockBody);
  expect(lock.status()).toBe(200);
  const token = lock.headers()['lock-token'];
  expect(token).toMatch(/^<.+>$/);
  expect((await dav('PUT', '/notes.txt', {}, 'no token')).status()).toBe(423);
  expect((await dav('PUT', '/notes.txt', { If: `(${token})` }, 'with token')).status()).toBe(204);
  expect((await dav('UNLOCK', '/notes.txt', { 'Lock-Token': token })).status()).toBe(204);
  expect((await dav('PUT', '/notes.txt', {}, 'unlocked')).status()).toBe(204);

  // MOVE with Overwrite: T onto an existing file keeps the destination's id,
  // and its previous content becomes a version.
  expect((await dav('PUT', '/report.txt', {}, 'old report')).status()).toBe(201);
  expect((await dav('PUT', '/draft.txt', {}, 'new report')).status()).toBe(201);
  const reportBefore = (await userApi.list(ws.id)).find((n) => n.name === 'report.txt')!;
  const destination = new URL(`${base}/report.txt`, test.info().project.use.baseURL).toString();
  expect((await dav('MOVE', '/draft.txt', { Destination: destination, Overwrite: 'F' })).status()).toBe(412);
  expect((await dav('MOVE', '/draft.txt', { Destination: destination, Overwrite: 'T' })).status()).toBe(204);
  const after = await userApi.list(ws.id);
  expect(after.map((n) => n.name)).not.toContain('draft.txt');
  const reportAfter = after.find((n) => n.name === 'report.txt')!;
  expect(reportAfter.id).toBe(reportBefore.id);
  expect((await userApi.download(reportAfter.id)).toString()).toBe('new report');

  // The UI shows the same file with its history.
  await loginAs(page, user);
  await itemAction(page, 'report.txt', 'Version history');
  const details = page.getByRole('complementary', { name: 'Details' });
  await expect(details.getByRole('button', { name: 'Restore version 1' })).toBeVisible();
  await expect(row(page, 'draft.txt')).toHaveCount(0);
});
