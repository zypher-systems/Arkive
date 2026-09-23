import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const MiB = 1024 * 1024;

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Pseudo-random bytes (incompressible, so transfer sizes are real). */
export function bytes(size: number): Buffer {
  return randomBytes(size);
}

/** A temp dir removed at process exit is overkill; the OS tmp is fine for CI. */
export function tempDir(prefix = 'arkive-e2e-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Writes files (relative paths → content) under a fresh temp dir. */
export function writeTree(files: Record<string, string | Buffer>): string {
  const root = tempDir();
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return root;
}
