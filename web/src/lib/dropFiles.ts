/**
 * Turn a drop / file-input selection into `{ file, relPath }` entries,
 * walking dropped folders recursively so their structure can be recreated.
 */
export type PickedFile = { file: File; relPath: string };

type Entry = FileSystemEntry;

function readAllEntries(dir: FileSystemDirectoryEntry): Promise<Entry[]> {
  const reader = dir.createReader();
  const out: Entry[] = [];
  return new Promise((resolve, reject) => {
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(out);
        else {
          out.push(...batch);
          next(); // readEntries returns at most ~100 entries per call
        }
      }, reject);
    next();
  });
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walk(entry: Entry, prefix: string, out: PickedFile[]) {
  if (entry.isFile) {
    try {
      const file = await entryFile(entry as FileSystemFileEntry);
      out.push({ file, relPath: prefix + file.name });
    } catch {
      /* unreadable file (permissions) — skip */
    }
    return;
  }
  if (entry.isDirectory) {
    const children = await readAllEntries(entry as FileSystemDirectoryEntry).catch(() => [] as Entry[]);
    for (const child of children) await walk(child, `${prefix}${entry.name}/`, out);
  }
}

type HandleLike = { kind: 'file' | 'directory'; name: string; getFile?: () => Promise<File>; values?: () => AsyncIterable<HandleLike> };

async function walkHandle(handle: HandleLike, prefix: string, out: PickedFile[]) {
  if (handle.kind === 'file' && handle.getFile) {
    const file = await handle.getFile();
    out.push({ file, relPath: prefix + file.name });
  } else if (handle.kind === 'directory' && handle.values) {
    for await (const child of handle.values()) await walkHandle(child, `${prefix}${handle.name}/`, out);
  }
}

/** True when the drag carries OS files (as opposed to in-app node drags). */
export function dragHasFiles(dt: DataTransfer | null) {
  return !!dt && Array.from(dt.types).includes('Files');
}

/**
 * Must be called synchronously inside the `drop` handler: DataTransfer
 * items are only readable during the event, so entries are captured first
 * and walked afterwards.
 */
export function collectDrop(dt: DataTransfer): Promise<PickedFile[]> {
  const items = Array.from(dt.items || []).filter((i) => i.kind === 'file');
  const entries = items.map((i) => (typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null));
  if (entries.length && entries.every((e) => e)) {
    return (async () => {
      const out: PickedFile[] = [];
      for (const e of entries) await walk(e as Entry, '', out);
      return out;
    })();
  }
  const withHandles = items as unknown as { getAsFileSystemHandle?: () => Promise<HandleLike | null> }[];
  if (withHandles.length && withHandles.every((i) => typeof i.getAsFileSystemHandle === 'function')) {
    const pending = withHandles.map((i) => i.getAsFileSystemHandle!());
    return (async () => {
      const out: PickedFile[] = [];
      for (const p of pending) {
        const h = await p.catch(() => null);
        if (h) await walkHandle(h, '', out);
      }
      return out;
    })();
  }
  const files = Array.from(dt.files || []);
  return Promise.resolve(files.map((file) => ({ file, relPath: file.name })));
}

/** Entries from an `<input type=file>` (with or without `webkitdirectory`). */
export function fromFileList(list: FileList | File[] | null | undefined): PickedFile[] {
  return Array.from(list || []).map((file) => ({
    file,
    relPath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
  }));
}
