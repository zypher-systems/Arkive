import { expect, type Locator, type Page } from '@playwright/test';

/** A row (list/details) or tile of the current folder listing, by exact name. */
export function row(page: Page, name: string): Locator {
  return page.getByRole('option', { name, exact: true });
}

/** Opens the ⋯ menu of an item and picks an entry. */
export async function itemAction(page: Page, name: string, action: string | RegExp) {
  await row(page, name).hover();
  await page.getByRole('button', { name: `More actions for ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: action }).click();
}

export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.getByRole('status').filter({ hasText: text }).first()).toBeVisible();
}

/** Names in the current listing, in display order. */
export async function listedNames(page: Page): Promise<string[]> {
  const list = page.getByRole('listbox', { name: /^Contents of / });
  return list.getByRole('option').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') || ''));
}

export function listing(page: Page): Locator {
  return page.getByRole('listbox', { name: /^Contents of / });
}
