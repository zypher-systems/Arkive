import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  flattenKeys,
  interpolate,
  lookup,
  negotiateLocale,
  selectPlural,
  translate,
  type Dict,
} from './core.ts';
import { en } from './en.ts';

const source: Dict = {
  greet: 'Hello, {name}!',
  files: { one: '{count} file', other: '{count} files', zero: 'No files' },
  nested: { deep: { key: 'Deep' } },
};

describe('lookup', () => {
  it('resolves nested keys and plural tables', () => {
    assert.equal(lookup(source, 'nested.deep.key'), 'Deep');
    assert.deepEqual(lookup(source, 'files'), source.files);
  });
  it('returns undefined for branches and missing keys', () => {
    assert.equal(lookup(source, 'nested'), undefined);
    assert.equal(lookup(source, 'nope.nope'), undefined);
  });
});

describe('interpolate', () => {
  it('replaces placeholders and keeps unknown ones', () => {
    assert.equal(interpolate('{a} and {b}', { a: 1 }), '1 and {b}');
    assert.equal(interpolate('plain'), 'plain');
  });
});

describe('plurals', () => {
  it('uses Intl plural categories', () => {
    const forms = { one: 'one', other: 'other' };
    assert.equal(selectPlural(forms, 'en', 1), 'one');
    assert.equal(selectPlural(forms, 'en', 2), 'other');
  });
  it('prefers an explicit zero form', () => {
    assert.equal(translate('en', source, source, 'files', { count: 0 }), 'No files');
    assert.equal(translate('en', source, source, 'files', { count: 1 }), '1 file');
    assert.equal(translate('en', source, source, 'files', { count: 7 }), '7 files');
  });
  it('falls back to categories other locales need', () => {
    const pl = { one: 'plik', few: 'pliki', many: 'plików', other: 'pliku' };
    assert.equal(selectPlural(pl, 'pl', 3), 'pliki');
    assert.equal(selectPlural(pl, 'pl', 5), 'plików');
  });
});

describe('translate', () => {
  it('falls back to the source dictionary, then to the key', () => {
    const partial: Dict = { greet: 'Hallo, {name}!' };
    assert.equal(translate('de', partial, source, 'greet', { name: 'Ada' }), 'Hallo, Ada!');
    assert.equal(translate('de', partial, source, 'nested.deep.key'), 'Deep');
    assert.equal(translate('de', partial, source, 'missing.key'), 'missing.key');
  });
  it('merges partially translated plural tables with the source', () => {
    const partial: Dict = { files: { other: '{count} Dateien' } };
    assert.equal(translate('de', partial, source, 'files', { count: 1 }), '1 file');
    assert.equal(translate('de', partial, source, 'files', { count: 4 }), '4 Dateien');
  });
});

describe('negotiateLocale', () => {
  it('matches exact tags, then base languages', () => {
    assert.equal(negotiateLocale(['de-AT', 'en'], ['en', 'de'], 'en'), 'de');
    assert.equal(negotiateLocale(['pt-BR'], ['en', 'pt-BR'], 'en'), 'pt-BR');
    assert.equal(negotiateLocale(['ja'], ['en'], 'en'), 'en');
  });
});

describe('source dictionary', () => {
  it('has unique, non-empty leaves', () => {
    const keys = flattenKeys(en as unknown as Dict);
    assert.ok(keys.length > 100);
    for (const k of keys) {
      const v = lookup(en as unknown as Dict, k);
      if (typeof v === 'string') assert.ok(v.length > 0, `empty string at ${k}`);
    }
  });
  it('uses balanced placeholders', () => {
    for (const k of flattenKeys(en as unknown as Dict)) {
      const v = lookup(en as unknown as Dict, k);
      const texts = typeof v === 'string' ? [v] : Object.values(v ?? {});
      for (const text of texts) {
        const open = (String(text).match(/\{/g) || []).length;
        const close = (String(text).match(/\}/g) || []).length;
        assert.equal(open, close, `unbalanced braces at ${k}`);
      }
    }
  });
});
