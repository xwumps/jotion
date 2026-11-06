import {
  listOf,
  type DateVal,
  type PageVal,
  type PersonVal,
  type Type,
  type Value,
} from '@jotion/formula';
import type {
  ComputedValue,
  DatabaseDto,
  DateValue,
  FileValue,
  MemberDto,
  PropertyDto,
  RowDto,
} from '@jotion/shared';
import { optionsOf } from './property-meta';

/** Typ eines Properties in der Formelsprache (wie im Server, @jotion/compute). */
export function formulaTypeOf(p: PropertyDto): Type {
  switch (p.type) {
    case 'number':
    case 'unique_id':
      return 'number';
    case 'checkbox':
      return 'boolean';
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return 'date';
    case 'multi_select':
    case 'files':
      return listOf('text');
    case 'person':
      return listOf('person');
    case 'created_by':
    case 'last_edited_by':
      return 'person';
    case 'relation':
      return listOf('page');
    case 'formula':
    case 'rollup': {
      const rt = (p.config as { resultType?: string }).resultType ?? 'empty';
      return rt === 'list' ? listOf('any') : (rt as Type);
    }
    default:
      return 'text';
  }
}

export function propTypesOf(db: DatabaseDto, selfId?: string): Record<string, Type> {
  const out: Record<string, Type> = {};
  for (const p of db.properties) if (p.id !== selfId) out[p.name] = formulaTypeOf(p);
  return out;
}

const date = (d: DateValue): DateVal => {
  const ms = (s: string) => (d.hasTime ? Date.parse(s) : Date.parse(`${s}T00:00:00Z`));
  return { kind: 'date', start: ms(d.start), end: d.end ? ms(d.end) : null, hasTime: d.hasTime };
};

function fromComputed(v: ComputedValue | undefined): Value {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map((x) => fromComputed(x));
  if (typeof v !== 'object') return v;
  if ('kind' in v)
    return v.kind === 'person'
      ? { kind: 'person', id: v.id, name: v.name, email: '' }
      : { kind: 'page', id: v.id, title: v.title };
  return date(v);
}

/** Werte einer Zeile für die Vorschau im Formel-Editor (ohne Zugriff auf verknüpfte Seiten). */
export function rowScope(
  db: DatabaseDto,
  row: RowDto,
  members: MemberDto[],
): Record<string, Value> {
  const person = (id: string): PersonVal => {
    const m = members.find((x) => x.userId === id);
    return { kind: 'person', id, name: m?.name ?? '?', email: m?.email ?? '' };
  };
  const out: Record<string, Value> = {};
  for (const p of db.properties) {
    const v = row.values[p.id];
    switch (p.type) {
      case 'title':
        out[p.name] = row.title;
        break;
      case 'created_time':
        out[p.name] = { kind: 'date', start: Date.parse(row.createdAt), end: null, hasTime: true };
        break;
      case 'last_edited_time':
        out[p.name] = {
          kind: 'date',
          start: Date.parse(row.lastEditedAt),
          end: null,
          hasTime: true,
        };
        break;
      case 'created_by':
        out[p.name] = person(row.createdById);
        break;
      case 'last_edited_by':
        out[p.name] = person(row.lastEditedById);
        break;
      case 'select':
      case 'status':
        out[p.name] = optionsOf(p).find((o) => o.id === v)?.name ?? null;
        break;
      case 'multi_select':
        out[p.name] = ((v as string[] | undefined) ?? []).map(
          (id) => optionsOf(p).find((o) => o.id === id)?.name ?? '',
        );
        break;
      case 'person':
        out[p.name] = ((v as string[] | undefined) ?? []).map(person);
        break;
      case 'checkbox':
        out[p.name] = v === true;
        break;
      case 'date':
        out[p.name] = v ? date(v as DateValue) : null;
        break;
      case 'files':
        out[p.name] = ((v as FileValue[] | undefined) ?? []).map((f) => f.name);
        break;
      case 'relation':
        out[p.name] = ((v as string[] | undefined) ?? []).map((id): PageVal => ({
          kind: 'page',
          id,
          title: row.refs?.[id]?.title ?? '',
        }));
        break;
      case 'formula':
      case 'rollup':
        out[p.name] = fromComputed(v as ComputedValue);
        break;
      default:
        out[p.name] = (v as Value) ?? null;
    }
  }
  return out;
}
