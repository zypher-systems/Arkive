const GB = 1024 ** 3;

/** "" or non-positive → null (unlimited); otherwise GB → bytes. */
export function gbToBytes(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * GB);
}

export function bytesToGb(bytes: number | null | undefined): string {
  if (!bytes) return '';
  const gb = bytes / GB;
  return String(Math.round(gb * 100) / 100);
}

export function errText(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}
