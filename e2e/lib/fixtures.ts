import { test as base, expect, type Page } from '@playwright/test';
import { Api, newUser, type User } from './api';
import { ADMIN, fakeIP } from './env';

type Creds = { email: string; password: string };

type Fixtures = {
  /** Client address for this test (see fakeIP). */
  clientIP: string;
  /** Console messages matching one of these are not treated as errors. */
  allowedErrors: RegExp[];
  /** Attaches the error guard to a page (done automatically for `page`). */
  watchPage: (page: Page) => void;
  /** Fails the test on uncaught page errors, console errors or 5xx. */
  errorGuard: void;
  /** A second, guarded browser context logged in as someone else (null: anonymous). */
  openAs: (who: Creds | null, path?: string) => Promise<Page>;
  /** A fresh approved user, created per test. */
  user: User;
  /** API client logged in as `user`. */
  userApi: Api;
  /** API client logged in as the instance admin. */
  adminApi: Api;
};

// Chrome logs every non-2xx fetch as "Failed to load resource"; expected 4xx
// (wrong password, 401 before login, 403 on a read share) are normal flows.
const benign = [/Failed to load resource: the server responded with a status of 4\d\d/];

export const test = base.extend<Fixtures & { problems: string[] }>({
  clientIP: [async ({}, use) => use(fakeIP()), { option: true }],
  allowedErrors: [[], { option: true }],
  extraHTTPHeaders: async ({ clientIP }, use) => use({ 'X-Forwarded-For': clientIP }),

  problems: async ({}, use) => use([]),
  watchPage: async ({ problems, allowedErrors }, use) => {
    const allowed = [...benign, ...allowedErrors];
    await use((page: Page) => {
      page.on('pageerror', (err) => problems.push(`uncaught: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (allowed.some((re) => re.test(text))) return;
        problems.push(`console.error: ${text}`);
      });
      page.on('response', (res) => {
        if (res.status() >= 500) problems.push(`HTTP ${res.status()} ${res.request().method()} ${res.url()}`);
      });
    });
  },
  errorGuard: [
    async ({ context, problems, watchPage }, use, testInfo) => {
      context.pages().forEach(watchPage);
      context.on('page', watchPage);
      await use();
      if (problems.length && testInfo.status === testInfo.expectedStatus) {
        await testInfo.attach('page-errors', { body: problems.join('\n') });
        expect(problems, 'page errors / 5xx during the test').toEqual([]);
      }
    },
    { auto: true },
  ],

  openAs: async ({ browser, watchPage }, use) => {
    const contexts: import('@playwright/test').BrowserContext[] = [];
    await use(async (who, path = '/') => {
      const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': fakeIP() } });
      contexts.push(ctx);
      ctx.on('page', watchPage);
      const page = await ctx.newPage();
      if (who) await loginAs(page, who, path);
      else await page.goto(path);
      return page;
    });
    for (const ctx of contexts) await ctx.close();
  },

  user: async ({}, use) => use(await newUser()),
  userApi: async ({ user }, use) => {
    const api = await Api.as(user);
    await use(api);
    await api.dispose();
  },
  adminApi: async ({}, use) => {
    const api = await Api.admin();
    await use(api);
    await api.dispose();
  },
});

export { expect };

/** Logs the page's context in through the API and opens the app. */
export async function loginAs(page: Page, user: Creds, path = '/') {
  const res = await page.request.post('/api/auth/login', { data: { email: user.email, password: user.password } });
  expect(res.ok(), `login ${user.email}: ${res.status()}`).toBeTruthy();
  await page.goto(path);
}

export async function loginAsAdmin(page: Page, path = '/') {
  return loginAs(page, ADMIN, path);
}
