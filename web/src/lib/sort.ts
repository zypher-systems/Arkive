/** File list sorting (pure). Folders always come first, like every desktop file manager. */

export type SortKey = 'name' | 'size' | 'modified' | 'type';
export type SortDir = 'asc' | 'desc';
export type SortSpec = { key: SortKey; dir: SortDir };

export type Sortable = {
  name: string;
  kind: 'file' | 'folder';
  size: number;
  updated_at: string;
  mime?: string | null;
};

const collators = new Map<string, Intl.Collator>();
function collator(locale: string) {
  let c = collators.get(locale);
  if (!c) {
    c = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    collators.set(locale, c);
  }
  return c;
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function compareNodes(a: Sortable, b: Sortable, spec: SortSpec, locale = 'en'): number {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
  const c = collator(locale);
  const byName = c.compare(a.name, b.name);
  let r = 0;
  switch (spec.key) {
    case 'size':
      // Folders have no meaningful size; keep them alphabetical.
      r = a.kind === 'folder' ? 0 : a.size - b.size;
      break;
    case 'modified':
      r = Date.parse(a.updated_at) - Date.parse(b.updated_at);
      break;
    case 'type':
      r = c.compare(extensionOf(a.name), extensionOf(b.name));
      break;
    default:
      r = byName;
  }
  if (r === 0) r = spec.key === 'name' ? 0 : byName;
  return spec.dir === 'asc' ? r : -r;
}

export function sortNodes<T extends Sortable>(nodes: readonly T[], spec: SortSpec, locale = 'en'): T[] {
  return [...nodes].sort((a, b) => compareNodes(a, b, spec, locale));
}

/** Clicking a header: same key flips direction; a new key starts with a sensible default. */
export function nextSort(current: SortSpec, key: SortKey): SortSpec {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'modified' || key === 'size' ? 'desc' : 'asc' };
}

export function parseSort(raw: string | null | undefined): SortSpec {
  const [key, dir] = (raw || '').split(':');
  const k: SortKey = key === 'size' || key === 'modified' || key === 'type' ? key : 'name';
  const d: SortDir = dir === 'desc' ? 'desc' : 'asc';
  return { key: k, dir: d };
}

export function serializeSort(s: SortSpec) {
  return `${s.key}:${s.dir}`;
}
