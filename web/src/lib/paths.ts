/** Name & path helpers (pure). */

/** Split "report.final.pdf" → ["report.final", ".pdf"]; dotfiles keep their name. */
export function splitExt(name: string): [string, string] {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return [name, ''];
  return [name.slice(0, i), name.slice(i)];
}

/** Characters rejected by common filesystems / our API. */
const INVALID = /[/\\\u0000]/;

export type NameProblem = 'empty' | 'invalid-char' | 'reserved' | 'too-long' | 'exists';

export function validateName(raw: string, siblings: readonly string[] = [], current?: string): NameProblem | null {
  const name = raw.trim();
  if (!name) return 'empty';
  if (name === '.' || name === '..') return 'reserved';
  if (INVALID.test(name)) return 'invalid-char';
  if (new TextEncoder().encode(name).length > 255) return 'too-long';
  const lower = name.toLowerCase();
  if (siblings.some((s) => s.toLowerCase() === lower && s !== current)) return 'exists';
  return null;
}

/** Selection range for renaming: select the base name, not the extension. */
export function renameSelection(name: string, isFolder: boolean): [number, number] {
  if (isFolder) return [0, name.length];
  const [base] = splitExt(name);
  return [0, base.length];
}

/** "notes" → "notes.txt"; keeps any explicit extension. */
export function ensureExtension(raw: string, fallbackExt = '.txt'): string {
  const name = raw.trim();
  if (!name) return '';
  return splitExt(name)[1] ? name : `${name}${fallbackExt}`;
}

/** Next free name following the server's `name (1).ext` convention. */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const set = new Set(Array.from(taken, (s) => s.toLowerCase()));
  if (!set.has(name.toLowerCase())) return name;
  const [base, ext] = splitExt(name);
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!set.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}

/**
 * Collapse a breadcrumb trail to at most `max` visible items, keeping the
 * first and the last `max - 2` crumbs and folding the middle into an
 * overflow menu.
 */
export function collapseCrumbs<T>(crumbs: readonly T[], max: number): { head: T[]; hidden: T[]; tail: T[] } {
  if (crumbs.length <= max || max < 3) return { head: [...crumbs], hidden: [], tail: [] };
  const tailCount = max - 2;
  return {
    head: crumbs.slice(0, 1),
    hidden: crumbs.slice(1, crumbs.length - tailCount),
    tail: crumbs.slice(crumbs.length - tailCount),
  };
}

/** Folder part of a relative upload path: "a/b/c.txt" → "a/b". */
export function dirOf(relPath: string): string {
  const clean = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const i = clean.lastIndexOf('/');
  return i < 0 ? '' : clean.slice(0, i);
}

export function baseOf(relPath: string): string {
  const clean = relPath.replace(/\\/g, '/');
  const i = clean.lastIndexOf('/');
  return i < 0 ? clean : clean.slice(i + 1);
}

/**
 * All folder paths that must exist for a set of relative file paths,
 * parents before children: ["a", "a/b", "c"].
 */
export function foldersToCreate(relPaths: readonly string[]): string[] {
  const out = new Set<string>();
  for (const p of relPaths) {
    const dir = dirOf(p);
    if (!dir) continue;
    const parts = dir.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/'));
  }
  return [...out].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

/** Top-level entries of a drop (folder names or file names), for summaries. */
export function topLevelNames(relPaths: readonly string[]): string[] {
  const out = new Set<string>();
  for (const p of relPaths) {
    const clean = p.replace(/\\/g, '/').replace(/^\/+/, '');
    out.add(clean.split('/')[0]);
  }
  return [...out];
}
