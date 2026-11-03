/**
 * Cursor für Keyset-Pagination: Sortierschlüssel der letzten Zeile, Position und ID.
 * Base64url-JSON, vom Server erzeugt und beim Lesen streng geprüft.
 */
export interface CursorKey {
  type: 'text' | 'float8' | 'int' | 'bool' | 'timestamptz';
}

export interface DecodedCursor {
  signature: string;
  types: CursorKey['type'][];
  values: (string | number | boolean | null)[];
  position: string;
  id: string;
}

const TYPES = new Set(['text', 'float8', 'int', 'bool', 'timestamptz']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Normalisiert einen Schlüsselwert aus der Datenbank (Date wird ISO-String). */
function keyValue(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  return String(v);
}

export function encodeCursor(
  signature: string,
  types: CursorKey['type'][],
  row: { id: string; position: string } & Record<string, unknown>,
): string {
  const values = types.map((_, i) => keyValue(row[`k${i}`]));
  const json = JSON.stringify({ s: signature, t: types, v: values, p: row.position, i: row.id });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): DecodedCursor | null {
  try {
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const { s, t, v, p, i } = raw;
    if (typeof s !== 'string' || typeof p !== 'string' || typeof i !== 'string') return null;
    if (!UUID.test(i) || p.length > 200) return null;
    if (!Array.isArray(t) || !Array.isArray(v) || t.length !== v.length || t.length > 20)
      return null;
    if (!t.every((x) => typeof x === 'string' && TYPES.has(x))) return null;
    const values = v.map((x, idx) => {
      if (x === null) return null;
      const type = t[idx] as CursorKey['type'];
      if (type === 'text' || type === 'timestamptz') {
        if (typeof x !== 'string' || x.length > 5000) throw new Error('bad');
        if (type === 'timestamptz' && Number.isNaN(Date.parse(x))) throw new Error('bad');
        return x;
      }
      if (type === 'bool') {
        if (typeof x !== 'boolean') throw new Error('bad');
        return x;
      }
      if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error('bad');
      return x;
    });
    return { signature: s, types: t as CursorKey['type'][], values, position: p, id: i };
  } catch {
    return null;
  }
}
