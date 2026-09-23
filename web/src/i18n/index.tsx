import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { negotiateLocale, translate, type Dict, type Leaves, type Vars } from './core';
import { en } from './en';
import { LOCALES, type LocaleCode, type LocaleEntry } from './locales';
import * as fmt from './format';

export type TKey = Leaves<typeof en>;
export type TFunction = (key: TKey, vars?: Vars) => string;

const STORAGE_KEY = 'arkive.locale';
const SOURCE = en as unknown as Dict;

function initialLocale(): LocaleCode {
  const codes = LOCALES.map((l) => l.code);
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (codes as string[]).includes(stored)) return stored as LocaleCode;
  } catch {
    /* ignore */
  }
  const preferred = typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : [];
  return negotiateLocale(preferred, codes, 'en') as LocaleCode;
}

// Module-level mirror so non-React code (api errors, upload manager) can translate.
let activeLocale: string = 'en';
let activeDict: Dict | undefined = SOURCE;

export function t(key: TKey, vars?: Vars): string {
  return translate(activeLocale, activeDict, SOURCE, key, vars);
}

type I18nState = {
  locale: LocaleCode;
  setLocale: (code: LocaleCode) => void;
  t: TFunction;
  formatBytes: (n: number) => string;
  formatNumber: (n: number) => string;
  formatDateTime: (d: string | number | Date) => string;
  formatDate: (d: string | number | Date) => string;
  formatModified: (d: string | number | Date) => string;
  formatRelative: (d: string | number | Date) => string;
};

const I18nContext = createContext<I18nState | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>(initialLocale);
  const [dict, setDict] = useState<Dict | undefined>(SOURCE);

  useEffect(() => {
    let cancelled = false;
    const entry = (LOCALES as readonly LocaleEntry[]).find((l) => l.code === locale);
    if (!entry || entry.code === 'en') {
      setDict(SOURCE);
    } else if (entry.load) {
      void entry.load().then((d) => {
        if (!cancelled) setDict(d as Dict);
      });
    }
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
    return () => {
      cancelled = true;
    };
  }, [locale]);

  activeLocale = locale;
  activeDict = dict;

  const tt = useCallback<TFunction>((key, vars) => translate(locale, dict, SOURCE, key, vars), [locale, dict]);

  const value = useMemo<I18nState>(
    () => ({
      locale,
      setLocale: setLocaleState,
      t: tt,
      formatBytes: (n) => fmt.formatBytes(n, locale),
      formatNumber: (n) => fmt.formatNumber(n, locale),
      formatDateTime: (d) => fmt.formatDateTime(d, locale),
      formatDate: (d) => fmt.formatDate(d, locale),
      formatModified: (d) => fmt.formatModified(d, locale),
      formatRelative: (d) => fmt.formatRelative(d, locale),
    }),
    [locale, tt],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}

/** Shorthand: `const t = useT();` */
export function useT(): TFunction {
  return useI18n().t;
}
