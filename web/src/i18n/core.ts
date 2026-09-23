/**
 * Tiny, dependency-free i18n core. Pure functions only so it can be unit
 * tested with `node --test` and shared by the React provider.
 *
 * Dictionaries are nested objects. A leaf is either a string or a plural
 * table `{ one: '…', other: '…' }` (any Intl.PluralRules category plus an
 * optional `zero`). Placeholders use `{name}`.
 */

export type PluralForms = {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

export type Dict = { [key: string]: string | PluralForms | Dict };

export type Vars = Record<string, string | number | null | undefined>;

/** Deep-partial dictionary shape used by non-source locales. */
export type PartialDict<T> = {
  [K in keyof T]?: T[K] extends string
    ? string
    : T[K] extends { other: string }
      ? Partial<PluralForms>
      : PartialDict<T[K]>;
};

/** Every dotted path to a leaf (string or plural table) in a dictionary type. */
export type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : T[K] extends { other: string }
      ? `${P}${K}`
      : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export function isPluralForms(v: unknown): v is PluralForms {
  return !!v && typeof v === 'object' && typeof (v as { other?: unknown }).other === 'string';
}

/** Resolve a dotted key. Returns undefined when missing or when it points at a branch. */
export function lookup(dict: Dict | undefined, key: string): string | PluralForms | undefined {
  if (!dict) return undefined;
  let cur: unknown = dict;
  for (const part of key.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  if (typeof cur === 'string') return cur;
  if (isPluralForms(cur)) return cur;
  return undefined;
}

/** Replace `{name}` placeholders. Unknown placeholders are left untouched. */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? m : String(v);
  });
}

const rulesCache = new Map<string, Intl.PluralRules>();

export function pluralCategory(locale: string, count: number): Intl.LDMLPluralRule {
  let rules = rulesCache.get(locale);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(locale);
    } catch {
      rules = new Intl.PluralRules('en');
    }
    rulesCache.set(locale, rules);
  }
  return rules.select(count);
}

export function selectPlural(forms: PluralForms, locale: string, count: number): string {
  if (count === 0 && forms.zero !== undefined) return forms.zero;
  const cat = pluralCategory(locale, count);
  return forms[cat] ?? forms.other;
}

/**
 * Translate `key` using `dict`, falling back to `fallback` (the source
 * locale) and finally to the key itself so a missing string is visible but
 * never crashes the UI.
 */
export function translate(
  locale: string,
  dict: Dict | undefined,
  fallback: Dict,
  key: string,
  vars?: Vars,
): string {
  const entry = lookup(dict, key) ?? lookup(fallback, key);
  if (entry === undefined) return key;
  if (typeof entry === 'string') return interpolate(entry, vars);
  const count = typeof vars?.count === 'number' ? vars.count : Number(vars?.count ?? 0);
  // A partially translated plural table falls back to the source table.
  const fb = lookup(fallback, key);
  const merged: PluralForms = isPluralForms(fb) ? { ...fb, ...entry } : entry;
  return interpolate(selectPlural(merged, locale, count), vars);
}

/** Flatten a dictionary into dotted keys (used by tests and tooling). */
export function flattenKeys(dict: Dict, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(dict)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string' || isPluralForms(v)) out.push(path);
    else out.push(...flattenKeys(v, path));
  }
  return out;
}

/** Pick the best supported locale for a list of preferred BCP-47 tags. */
export function negotiateLocale(
  preferred: readonly string[],
  supported: readonly string[],
  fallback: string,
): string {
  for (const tag of preferred) {
    const lower = tag.toLowerCase();
    const exact = supported.find((s) => s.toLowerCase() === lower);
    if (exact) return exact;
    const base = lower.split('-')[0];
    const partial = supported.find((s) => s.toLowerCase().split('-')[0] === base);
    if (partial) return partial;
  }
  return fallback;
}
