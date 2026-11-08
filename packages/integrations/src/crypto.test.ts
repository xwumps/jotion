import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CryptoError, SecretBox } from './crypto';

const k = () => randomBytes(32).toString('base64');

describe('SecretBox', () => {
  it('verschlüsselt und entschlüsselt, jedes Mal mit neuem IV', () => {
    const box = new SecretBox(k());
    const a = box.encrypt('geheim', 'conn:1');
    const b = box.encrypt('geheim', 'conn:1');
    expect(a).not.toBe(b);
    expect(a).not.toContain('geheim');
    expect(box.decrypt(a, 'conn:1')).toBe('geheim');
    expect(box.decrypt(box.encrypt('', 'x'), 'x')).toBe('');
    expect(box.decrypt(box.encrypt('äöü 🔐', 'x'), 'x')).toBe('äöü 🔐');
  });

  it('erkennt Manipulation und falschen Verwendungszweck', () => {
    const box = new SecretBox(k());
    const a = box.encrypt('geheim', 'conn:1');
    expect(() => box.decrypt(a, 'conn:2')).toThrow(CryptoError);
    const parts = a.split(':');
    const data = Buffer.from(parts[4]!, 'base64url');
    data[0] = data[0]! ^ 1;
    parts[4] = data.toString('base64url');
    expect(() => box.decrypt(parts.join(':'), 'conn:1')).toThrow(CryptoError);
    expect(() => box.decrypt('kaputt', 'conn:1')).toThrow(CryptoError);
  });

  it('Rotation: alter Schlüssel im Ring entschlüsselt, rotate verschlüsselt neu', () => {
    const oldKey = k();
    const newKey = k();
    const before = new SecretBox(oldKey).encrypt('passwort', 'c');
    // Ohne alten Schlüssel nicht lesbar
    expect(() => new SecretBox(newKey).decrypt(before, 'c')).toThrow(/Rotation/);
    const ring = new SecretBox(newKey, [oldKey]);
    expect(ring.decrypt(before, 'c')).toBe('passwort');
    expect(ring.needsRotation(before)).toBe(true);
    const after = ring.rotate(before, 'c');
    expect(ring.needsRotation(after)).toBe(false);
    expect(new SecretBox(newKey).decrypt(after, 'c')).toBe('passwort');
    expect(ring.rotate(after, 'c')).toBe(after);
  });

  it('lehnt falsche Schlüssellängen ab', () => {
    expect(() => new SecretBox(randomBytes(16).toString('base64'))).toThrow(CryptoError);
  });
});
