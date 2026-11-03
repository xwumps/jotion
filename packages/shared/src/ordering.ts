/**
 * Fractional Indexing: Sortierschlüssel, zwischen die sich immer ein weiterer einfügen lässt.
 * Nach dem Verfahren von David Greenspan ("Implementing Fractional Indexing"), Base62.
 * Schlüssel bestehen aus einem Ganzzahlteil (Kopfzeichen bestimmt die Länge) und einem
 * Bruchteil ohne abschließende Null. Vergleich bytegenau (in PostgreSQL: COLLATE "C").
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITS[0]!;
const LAST = DIGITS[DIGITS.length - 1]!;
const SMALLEST_INTEGER = `A${ZERO.repeat(26)}`;

export class OrderKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderKeyError';
  }
}

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new OrderKeyError(`${a} >= ${b}`);
  if (a.endsWith(ZERO) || (b !== null && b.endsWith(ZERO))) {
    throw new OrderKeyError('abschließende Null im Bruchteil');
  }
  if (b !== null) {
    // gemeinsames Präfix übernehmen
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]!) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (digitB - digitA > 1) {
    return DIGITS[Math.round(0.5 * (digitA + digitB))]!;
  }
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA]! + midpoint(a.slice(1), null);
}

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new OrderKeyError(`ungültiges Kopfzeichen: ${head}`);
}

function integerPart(key: string): string {
  const len = integerLength(key[0] ?? '');
  if (len > key.length) throw new OrderKeyError(`ungültiger Schlüssel: ${key}`);
  return key.slice(0, len);
}

export function isValidOrderKey(key: string): boolean {
  try {
    validateOrderKey(key);
    return true;
  } catch {
    return false;
  }
}

function validateOrderKey(key: string): void {
  if (key === SMALLEST_INTEGER) throw new OrderKeyError(`ungültiger Schlüssel: ${key}`);
  for (const ch of key)
    if (!DIGITS.includes(ch)) throw new OrderKeyError(`ungültiges Zeichen: ${ch}`);
  const int = integerPart(key);
  if (key.slice(int.length).endsWith(ZERO)) throw new OrderKeyError(`ungültiger Schlüssel: ${key}`);
}

function incrementInteger(x: string): string | null {
  const [head, ...digs] = x.split('') as [string, ...string[]];
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]!) + 1;
    if (d === DIGITS.length) digs[i] = ZERO;
    else {
      digs[i] = DIGITS[d]!;
      carry = false;
    }
  }
  if (!carry) return head + digs.join('');
  if (head === 'Z') return `a${ZERO}`;
  if (head === 'z') return null;
  const h = String.fromCharCode(head.charCodeAt(0) + 1);
  if (h > 'a') digs.push(ZERO);
  else digs.pop();
  return h + digs.join('');
}

function decrementInteger(x: string): string | null {
  const [head, ...digs] = x.split('') as [string, ...string[]];
  let borrow = true;
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]!) - 1;
    if (d === -1) digs[i] = LAST;
    else {
      digs[i] = DIGITS[d]!;
      borrow = false;
    }
  }
  if (!borrow) return head + digs.join('');
  if (head === 'a') return `Z${LAST}`;
  if (head === 'A') return null;
  const h = String.fromCharCode(head.charCodeAt(0) - 1);
  if (h < 'Z') digs.push(LAST);
  else digs.pop();
  return h + digs.join('');
}

/** Schlüssel echt zwischen a und b. null bedeutet "Anfang" bzw. "Ende". */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null) validateOrderKey(a);
  if (b !== null) validateOrderKey(b);
  if (a !== null && b !== null && a >= b) throw new OrderKeyError(`${a} >= ${b}`);

  if (a === null) {
    if (b === null) return `a${ZERO}`;
    const ib = integerPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INTEGER) return ib + midpoint('', fb);
    if (ib < b) return ib;
    const res = decrementInteger(ib);
    if (res === null) throw new OrderKeyError('kleinster Schlüssel erreicht');
    return res;
  }

  if (b === null) {
    const ia = integerPart(a);
    const fa = a.slice(ia.length);
    const i = incrementInteger(ia);
    return i === null ? ia + midpoint(fa, null) : i;
  }

  const ia = integerPart(a);
  const fa = a.slice(ia.length);
  const ib = integerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const i = incrementInteger(ia);
  if (i === null) throw new OrderKeyError('größter Schlüssel erreicht');
  if (i < b) return i;
  return ia + midpoint(fa, null);
}

/** n aufeinanderfolgende Schlüssel zwischen a und b (für Mehrfach-Einfügen und Reindexierung). */
export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  const keys: string[] = [];
  let prev = a;
  for (let i = 0; i < n; i++) {
    // gleichmäßige Verteilung ist hier nicht nötig; Folge bleibt streng monoton
    const k = keyBetween(prev, b);
    keys.push(k);
    prev = k;
  }
  return keys;
}

/** Bytegenauer Vergleich, passend zu COLLATE "C". */
export function compareOrderKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
