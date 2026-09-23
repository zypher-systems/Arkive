import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareNodes, nextSort, parseSort, serializeSort, sortNodes, type Sortable } from './sort.ts';
import {
  collapseCrumbs,
  dirOf,
  baseOf,
  ensureExtension,
  foldersToCreate,
  renameSelection,
  splitExt,
  topLevelNames,
  uniqueName,
  validateName,
} from './paths.ts';
import { RateMeter, eta } from './rate.ts';
import { parseDelimited } from './csv.ts';
import { formatBytes, formatDuration, formatModified } from '../i18n/format.ts';

const n = (name: string, kind: 'file' | 'folder', size = 0, updated = '2024-01-01T00:00:00Z'): Sortable => ({
  name,
  kind,
  size,
  updated_at: updated,
});

describe('sortNodes', () => {
  const list = [
    n('b.txt', 'file', 30, '2024-03-01T00:00:00Z'),
    n('Zeta', 'folder'),
    n('file10.txt', 'file', 5, '2024-01-01T00:00:00Z'),
    n('file2.txt', 'file', 500, '2024-02-01T00:00:00Z'),
    n('alpha', 'folder'),
  ];
  it('keeps folders first and uses natural name order', () => {
    assert.deepEqual(
      sortNodes(list, { key: 'name', dir: 'asc' }).map((x) => x.name),
      ['alpha', 'Zeta', 'b.txt', 'file2.txt', 'file10.txt'],
    );
  });
  it('keeps folders first even when descending', () => {
    assert.deepEqual(
      sortNodes(list, { key: 'name', dir: 'desc' }).map((x) => x.name),
      ['Zeta', 'alpha', 'file10.txt', 'file2.txt', 'b.txt'],
    );
  });
  it('sorts by size and modified', () => {
    assert.deepEqual(
      sortNodes(list, { key: 'size', dir: 'desc' }).filter((x) => x.kind === 'file').map((x) => x.name),
      ['file2.txt', 'b.txt', 'file10.txt'],
    );
    assert.deepEqual(
      sortNodes(list, { key: 'modified', dir: 'asc' }).filter((x) => x.kind === 'file').map((x) => x.name),
      ['file10.txt', 'file2.txt', 'b.txt'],
    );
  });
  it('breaks ties by name', () => {
    const a = n('a.txt', 'file', 1);
    const b = n('b.txt', 'file', 1);
    assert.ok(compareNodes(a, b, { key: 'size', dir: 'asc' }) < 0);
  });
  it('toggles and parses sort specs', () => {
    assert.deepEqual(nextSort({ key: 'name', dir: 'asc' }, 'name'), { key: 'name', dir: 'desc' });
    assert.deepEqual(nextSort({ key: 'name', dir: 'asc' }, 'modified'), { key: 'modified', dir: 'desc' });
    assert.deepEqual(parseSort('size:desc'), { key: 'size', dir: 'desc' });
    assert.deepEqual(parseSort('garbage'), { key: 'name', dir: 'asc' });
    assert.equal(serializeSort({ key: 'type', dir: 'asc' }), 'type:asc');
  });
});

describe('paths', () => {
  it('splits extensions', () => {
    assert.deepEqual(splitExt('a.tar.gz'), ['a.tar', '.gz']);
    assert.deepEqual(splitExt('.env'), ['.env', '']);
    assert.deepEqual(splitExt('README'), ['README', '']);
  });
  it('validates names', () => {
    assert.equal(validateName('  '), 'empty');
    assert.equal(validateName('a/b'), 'invalid-char');
    assert.equal(validateName('..'), 'reserved');
    assert.equal(validateName('Notes.md', ['notes.md']), 'exists');
    assert.equal(validateName('notes.md', ['notes.md'], 'notes.md'), null);
    assert.equal(validateName('x'.repeat(300)), 'too-long');
  });
  it('selects the base name for rename', () => {
    assert.deepEqual(renameSelection('photo.jpeg', false), [0, 5]);
    assert.deepEqual(renameSelection('My.Folder', true), [0, 9]);
  });
  it('ensures extensions', () => {
    assert.equal(ensureExtension('notes'), 'notes.txt');
    assert.equal(ensureExtension('notes.md'), 'notes.md');
    assert.equal(ensureExtension('  '), '');
  });
  it('finds unique names like the server', () => {
    assert.equal(uniqueName('a.txt', ['b.txt']), 'a.txt');
    assert.equal(uniqueName('a.txt', ['a.txt', 'a (1).txt']), 'a (2).txt');
    assert.equal(uniqueName('Folder', ['folder']), 'Folder (1)');
  });
  it('collapses breadcrumbs', () => {
    const c = ['root', 'a', 'b', 'c', 'd', 'e'];
    assert.deepEqual(collapseCrumbs(c, 4), { head: ['root'], hidden: ['a', 'b', 'c'], tail: ['d', 'e'] });
    assert.deepEqual(collapseCrumbs(['a', 'b'], 4), { head: ['a', 'b'], hidden: [], tail: [] });
  });
  it('derives folders to create for a folder upload', () => {
    assert.equal(dirOf('a/b/c.txt'), 'a/b');
    assert.equal(dirOf('c.txt'), '');
    assert.equal(baseOf('a\\b\\c.txt'), 'c.txt');
    assert.deepEqual(foldersToCreate(['a/b/c.txt', 'a/d.txt', 'x.txt', 'e/f/g/h.txt']), [
      'a',
      'e',
      'a/b',
      'e/f',
      'e/f/g',
    ]);
    assert.deepEqual(topLevelNames(['a/b.txt', 'a/c.txt', 'x.txt']), ['a', 'x.txt']);
  });
});

describe('rate & formatting', () => {
  it('computes a windowed rate and eta', () => {
    const m = new RateMeter(5000);
    m.push(0, 0);
    assert.equal(m.rate(), 0);
    m.push(1000, 1_000_000);
    m.push(2000, 2_000_000);
    assert.equal(Math.round(m.rate()), 1_000_000);
    assert.equal(eta(3_000_000, m.rate()), 3);
    assert.equal(eta(10, 0), null);
    assert.equal(eta(0, 0), 0);
  });
  it('formats bytes and durations', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(1536), '1.5 KB');
    assert.equal(formatBytes(10 * 1024 ** 3), '10 GB');
    assert.equal(formatDuration(5), '5s');
    assert.equal(formatDuration(125), '2m 05s');
    assert.equal(formatDuration(3725), '1h 02m');
  });
  it('formats modified dates relative to now', () => {
    const now = new Date('2024-06-15T12:00:00');
    assert.match(formatModified(new Date('2024-06-15T09:30:00'), 'en', now), /9:30/);
    assert.equal(formatModified(new Date('2024-06-14T09:30:00'), 'en', now), 'yesterday');
    assert.equal(formatModified(new Date('2024-01-02T09:30:00'), 'en', now), 'Jan 2');
    assert.equal(formatModified(new Date('2022-01-02T09:30:00'), 'en', now), 'Jan 2, 2022');
  });
});

describe('parseDelimited', () => {
  it('handles quotes, escaped quotes and CRLF', () => {
    assert.deepEqual(parseDelimited('a,b\r\n"x, y","say ""hi"""\n3,'), [
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['3', ''],
    ]);
  });
  it('supports tabs and row limits', () => {
    assert.deepEqual(parseDelimited('a\tb\nc\td', '\t'), [['a', 'b'], ['c', 'd']]);
    assert.equal(parseDelimited('1\n2\n3\n4', ',', 2).length, 2);
  });
});
