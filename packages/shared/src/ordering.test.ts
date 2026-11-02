import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compareOrderKeys, isValidOrderKey, keyBetween, keysBetween } from './ordering';

describe('keyBetween', () => {
  it('liefert bekannte Startwerte', () => {
    expect(keyBetween(null, null)).toBe('a0');
    expect(keyBetween('a0', null)).toBe('a1');
    expect(keyBetween(null, 'a0')).toBe('Zz');
    expect(keyBetween('a0', 'a1')).toBe('a0V');
  });

  it('lehnt falsche Reihenfolge und ungültige Schlüssel ab', () => {
    expect(() => keyBetween('a1', 'a0')).toThrow();
    expect(() => keyBetween('a1', 'a1')).toThrow();
    expect(() => keyBetween('a00', null)).toThrow();
    expect(() => keyBetween('a!', null)).toThrow();
  });

  it('bleibt kurz beim wiederholten Anhängen am Ende', () => {
    let k: string | null = null;
    for (let i = 0; i < 10_000; i++) k = keyBetween(k, null);
    expect(k!.length).toBeLessThanOrEqual(5);
  });

  it('erhält die Ordnung bei beliebigen Einfügefolgen (Property-Test)', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { minLength: 1, maxLength: 200 }), (choices) => {
        const keys: string[] = [];
        for (const c of choices) {
          const idx = c % (keys.length + 1);
          const k = keyBetween(keys[idx - 1] ?? null, keys[idx] ?? null);
          expect(isValidOrderKey(k)).toBe(true);
          keys.splice(idx, 0, k);
        }
        const sorted = [...keys].sort(compareOrderKeys);
        expect(sorted).toEqual(keys);
        expect(new Set(keys).size).toBe(keys.length);
      }),
      { numRuns: 300 },
    );
  });

  it('keysBetween liefert streng monotone Folgen innerhalb der Grenzen', () => {
    const ks = keysBetween('a0', 'a1', 50);
    expect(ks.every((k, i) => k > 'a0' && k < 'a1' && (i === 0 || k > ks[i - 1]!))).toBe(true);
  });
});
