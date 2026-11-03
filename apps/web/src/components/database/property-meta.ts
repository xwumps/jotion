import type {
  DateValue,
  NumberConfig,
  OptionColor,
  PropertyDto,
  PropertyType,
  RowDto,
} from '@jotion/shared';
import {
  AtSign,
  Calendar,
  CheckSquare,
  CircleDot,
  Clock,
  FileText,
  Fingerprint,
  Hash,
  Link,
  List,
  Paperclip,
  Phone,
  Sigma,
  Tags,
  Text,
  Type,
  User,
  UserPen,
  type LucideIcon,
} from 'lucide-react';

export const PROPERTY_ICONS: Record<PropertyType, LucideIcon> = {
  title: Type,
  text: Text,
  number: Hash,
  select: CircleDot,
  multi_select: Tags,
  status: List,
  date: Calendar,
  person: User,
  checkbox: CheckSquare,
  url: Link,
  email: AtSign,
  phone: Phone,
  files: Paperclip,
  created_time: Clock,
  created_by: User,
  last_edited_time: Clock,
  last_edited_by: UserPen,
  unique_id: Fingerprint,
  relation: FileText,
  rollup: Sigma,
  formula: Sigma,
};

/** Hintergrund einer Option (Notion-Farben aus den Design-Tokens). */
export function optionStyle(color: OptionColor | undefined): React.CSSProperties {
  if (!color || color === 'default') return { background: 'var(--active)' };
  return { background: `var(--cb-${color})`, color: 'var(--fg)' };
}

const CURRENCIES: Partial<Record<NumberConfig['format'], string>> = {
  euro: 'EUR',
  dollar: 'USD',
  pound: 'GBP',
  yen: 'JPY',
  franc: 'CHF',
};

export function formatNumber(n: number, config: NumberConfig | undefined, locale: string): string {
  const fmt = config?.format ?? 'number';
  const precision = config?.precision ?? undefined;
  const digits =
    precision === undefined || precision === null
      ? {}
      : { minimumFractionDigits: precision, maximumFractionDigits: precision };
  const currency = CURRENCIES[fmt];
  if (currency)
    return new Intl.NumberFormat(locale, { style: 'currency', currency, ...digits }).format(n);
  if (fmt === 'percent')
    return new Intl.NumberFormat(locale, { style: 'percent', ...digits }).format(n / 100);
  if (fmt === 'number_with_commas')
    return new Intl.NumberFormat(locale, { useGrouping: true, ...digits }).format(n);
  return new Intl.NumberFormat(locale, {
    useGrouping: false,
    maximumFractionDigits: 10,
    ...digits,
  }).format(n);
}

export function formatDay(day: string, locale: string, format = 'full'): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (format === 'iso') return day;
  const opts: Intl.DateTimeFormatOptions =
    format === 'short'
      ? { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }
      : { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' };
  return new Intl.DateTimeFormat(locale, opts).format(d);
}

export function formatInstant(iso: string, locale: string, format = 'full', h12 = false): string {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions =
    format === 'short'
      ? { day: '2-digit', month: '2-digit', year: 'numeric' }
      : { day: 'numeric', month: 'long', year: 'numeric' };
  return new Intl.DateTimeFormat(locale, {
    ...opts,
    hour: '2-digit',
    minute: '2-digit',
    hour12: h12,
  }).format(d);
}

export function formatDate(
  v: DateValue,
  locale: string,
  config?: { dateFormat?: string; timeFormat?: string },
): string {
  const one = (s: string) =>
    v.hasTime
      ? formatInstant(s, locale, config?.dateFormat, config?.timeFormat === '12h')
      : formatDay(s, locale, config?.dateFormat);
  return v.end ? `${one(v.start)} → ${one(v.end)}` : one(v.start);
}

/** Wert eines Properties für eine Zeile (abgeleitete Typen aus den Seitenfeldern). */
export function cellValue(row: RowDto, prop: PropertyDto): unknown {
  switch (prop.type) {
    case 'title':
      return row.title;
    case 'created_time':
      return row.createdAt;
    case 'last_edited_time':
      return row.lastEditedAt;
    case 'created_by':
      return row.createdById;
    case 'last_edited_by':
      return row.lastEditedById;
    default:
      return row.values[prop.id] ?? null;
  }
}

export function optionsOf(
  prop: PropertyDto,
): { id: string; name: string; color: OptionColor; group?: string }[] {
  return (
    (
      prop.config as {
        options?: { id: string; name: string; color: OptionColor; group?: string }[];
      }
    ).options ?? []
  );
}

/** Text einer Zelle für Suche/Kopieren. */
export function uniqueIdLabel(prop: PropertyDto, n: number): string {
  const prefix = (prop.config as { prefix?: string | null }).prefix;
  return prefix ? `${prefix}-${n}` : String(n);
}
