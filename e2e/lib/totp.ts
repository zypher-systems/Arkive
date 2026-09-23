import { createHmac } from 'node:crypto';

// Minimal RFC 6238 TOTP (SHA-1, 30 s, 6 digits) — what Arkive and every
// authenticator app use.

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error(`invalid base32 character ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpStep(now = Date.now()): number {
  return Math.floor(now / 1000 / 30);
}

export function totp(secret: string, step = totpStep()): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

/**
 * Codes are single use (replay protection), and the server accepts ±1 step:
 * each call returns the code for the next unused step, so a test can enable
 * 2FA and sign in again without waiting 30 seconds.
 */
export class TotpDevice {
  private last = -1;
  constructor(public readonly secret: string) {}
  next(): string {
    const step = Math.max(totpStep(), this.last + 1);
    this.last = step;
    return totp(this.secret, step);
  }
}
