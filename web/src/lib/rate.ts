/**
 * Transfer-rate estimator: a sliding window of (time, bytes) samples gives
 * a stable speed and ETA without jitter from single progress events.
 */
export type RateSample = { t: number; bytes: number };

export class RateMeter {
  private samples: RateSample[] = [];
  private windowMs: number;
  constructor(windowMs = 5000) {
    this.windowMs = windowMs;
  }

  push(t: number, bytes: number) {
    this.samples.push({ t, bytes });
    const cutoff = t - this.windowMs;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift();
  }

  /** Bytes per second, or 0 when there is not enough data yet. */
  rate(): number {
    if (this.samples.length < 2) return 0;
    const a = this.samples[0];
    const b = this.samples[this.samples.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0.2) return 0;
    return Math.max(0, (b.bytes - a.bytes) / dt);
  }

  reset() {
    this.samples = [];
  }
}

/** Seconds remaining, or null when unknown. */
export function eta(remainingBytes: number, bytesPerSecond: number): number | null {
  if (remainingBytes <= 0) return 0;
  if (!bytesPerSecond || !Number.isFinite(bytesPerSecond)) return null;
  return remainingBytes / bytesPerSecond;
}
