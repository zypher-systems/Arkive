import type { PartialDict } from './core';
import type { en } from './en';

/**
 * Registered UI languages. English is bundled; other locales are loaded on
 * demand so they never bloat the main bundle. To add one, see
 * docs/translating.md — in short:
 *
 *   { code: 'de', name: 'Deutsch', load: () => import('./de').then((m) => m.de) }
 */
export type LocaleEntry = {
  code: string;
  /** Endonym shown in the picker (the language's own name for itself). */
  name: string;
  load?: () => Promise<PartialDict<typeof en>>;
};

export const LOCALES = [{ code: 'en', name: 'English' }] as const satisfies readonly LocaleEntry[];

export type LocaleCode = (typeof LOCALES)[number]['code'];
