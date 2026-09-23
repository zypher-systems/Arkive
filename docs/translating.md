# Translating Arkive

The web UI routes every user-facing string through a small, dependency-free
i18n layer in `web/src/i18n/`. English is the source language; other
languages are plain TypeScript files that are loaded on demand, so adding one
never makes the app heavier for everyone else.

| File | Purpose |
| --- | --- |
| `en.ts` | The source dictionary — every string in the UI, grouped by feature. |
| `locales.ts` | The list of languages shown in **Account → Preferences → Language**. |
| `core.ts` | Lookup, `{placeholder}` interpolation and plural selection (pure, unit tested). |
| `format.ts` | Locale-aware dates, relative times, numbers and file sizes (via `Intl`). |
| `index.tsx` | React provider and the `useT()` / `useI18n()` hooks. |

## Contributing a language

1. **Copy the source file.** Create `web/src/i18n/<code>.ts` where `<code>` is
   a BCP 47 tag such as `de`, `fr`, `pt-BR` or `zh-Hans`:

   ```ts
   import type { PartialDict } from './core';
   import type { en } from './en';

   export const de: PartialDict<typeof en> = {
     common: {
       cancel: 'Abbrechen',
       // …
     },
   };
   ```

   Start from a copy of `en.ts` and translate the values. The `PartialDict`
   type makes the compiler check your keys; anything you leave out falls back
   to English, so you can translate incrementally.

2. **Register it** in `locales.ts`, using the language's own name for itself:

   ```ts
   export const LOCALES = [
     { code: 'en', name: 'English' },
     { code: 'de', name: 'Deutsch', load: () => import('./de').then((m) => m.de) },
   ] as const satisfies readonly LocaleEntry[];
   ```

3. **Check it.** From `web/`, run `npm test` (the dictionary tests catch
   unbalanced `{placeholders}`) and `npm run build`, then start the dev server
   (`npm run dev`) and pick your language under **Account → Preferences**.
   A first visit also picks it automatically when it matches the browser's
   preferred languages.

## Rules for translated strings

- **Translate values, never keys.** `files.moveToTrash` stays as is.
- **Keep placeholders intact.** `'Moved “{name}” to trash'` must still contain
  `{name}`; you may move it within the sentence.
- **Plurals.** Some entries are objects such as
  `{ one: '{count} file', other: '{count} files' }`. Provide the categories
  your language uses according to
  [CLDR plural rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)
  — for example `one`, `few`, `many`, `other` for Polish. An optional `zero`
  form is used for a count of 0 in any language. Missing categories fall back
  to your `other`, then to English.
- **Don't translate formats.** Dates, times, numbers and sizes are formatted
  by the browser's `Intl` APIs for the selected locale automatically.
- **Match the tone.** Short, plain and friendly; sentence case for buttons and
  headings ("Upload files", not "Upload Files"). Use your language's
  typographic quotes and apostrophes.
- **Mind the length.** Buttons and menu items have limited room, especially
  on phones. If a literal translation is long, prefer a shorter natural one.

## For developers: adding strings

Never hard-code UI text in components. Add a key to `en.ts` in the right
section, then use it:

```tsx
const { t } = useI18n();
<Button>{t('files.newFolder')}</Button>
toast({ message: t('files.trashed', { count: ids.length, name }) });
```

`t()` keys are type-checked against `en.ts`, so a typo is a compile error.
Outside React (for example in the upload engine) import `t` from
`web/src/i18n` directly. Server error messages are shown as returned by the
API.
