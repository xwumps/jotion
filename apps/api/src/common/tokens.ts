import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Zufälliges, URL-sicheres Token (256 Bit). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Gespeichert wird nur der Hash. SHA-256 genügt, da Tokens 256 Bit Zufall enthalten. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
