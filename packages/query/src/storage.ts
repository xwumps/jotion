import {
  dateValueMs,
  type DateValue,
  type FileValue,
  type PropertyType,
  type PropertyValue,
} from '@jotion/shared';

/** Typspalten von property_values (Prisma-Feldnamen). */
export interface StoredColumns {
  vText: string | null;
  vNumber: number | null;
  vBool: boolean | null;
  vDateStart: Date | null;
  vDateEnd: Date | null;
  vDateHasTime: boolean | null;
  vTz: string | null;
  vOptionIds: string[];
  vUserIds: string[];
  vJson: unknown;
}

const EMPTY: StoredColumns = {
  vText: null,
  vNumber: null,
  vBool: null,
  vDateStart: null,
  vDateEnd: null,
  vDateHasTime: null,
  vTz: null,
  vOptionIds: [],
  vUserIds: [],
  vJson: null,
};

/**
 * Wert (bereits validiert) in Typspalten. null bedeutet: kein Eintrag (leerer Wert).
 * Leere Texte, leere Listen und nicht angehakte Checkboxen werden nicht gespeichert.
 */
export function toStorage(type: PropertyType, value: PropertyValue): StoredColumns | null {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return typeof value === 'string' && value !== '' ? { ...EMPTY, vText: value } : null;
    case 'number':
    case 'unique_id':
      return typeof value === 'number' ? { ...EMPTY, vNumber: value } : null;
    case 'select':
    case 'status':
      return typeof value === 'string' ? { ...EMPTY, vOptionIds: [value] } : null;
    case 'multi_select':
      return Array.isArray(value) && value.length
        ? { ...EMPTY, vOptionIds: value as string[] }
        : null;
    case 'person':
      return Array.isArray(value) && value.length
        ? { ...EMPTY, vUserIds: value as string[] }
        : null;
    case 'checkbox':
      return value === true ? { ...EMPTY, vBool: true } : null;
    case 'date': {
      const d = value as DateValue;
      return {
        ...EMPTY,
        vDateStart: new Date(dateValueMs(d.start, d.hasTime)),
        vDateEnd: d.end ? new Date(dateValueMs(d.end, d.hasTime)) : null,
        vDateHasTime: d.hasTime,
        vTz: d.timeZone,
      };
    }
    case 'files':
      return Array.isArray(value) && value.length ? { ...EMPTY, vJson: value } : null;
    default:
      return null;
  }
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Typspalten zurück in das API-Format. */
export function fromStorage(type: PropertyType, c: StoredColumns): PropertyValue {
  switch (type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return c.vText;
    case 'number':
    case 'unique_id':
      return c.vNumber;
    case 'select':
    case 'status':
      return c.vOptionIds[0] ?? null;
    case 'multi_select':
      return c.vOptionIds;
    case 'person':
      return c.vUserIds;
    case 'checkbox':
      return c.vBool === true;
    case 'date': {
      if (!c.vDateStart) return null;
      const hasTime = Boolean(c.vDateHasTime);
      const fmt = (d: Date) => (hasTime ? d.toISOString() : isoDay(d));
      return {
        start: fmt(c.vDateStart),
        end: c.vDateEnd ? fmt(c.vDateEnd) : null,
        hasTime,
        timeZone: c.vTz,
      };
    }
    case 'files':
      return Array.isArray(c.vJson) ? (c.vJson as FileValue[]) : [];
    // Berechnete Werte (Formel, Rollup) liegen vollständig in v_json
    case 'formula':
    case 'rollup':
      return (c.vJson ?? null) as PropertyValue;
    default:
      return null;
  }
}
