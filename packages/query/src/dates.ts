import type { DateOperand, DateRange } from '@jotion/shared';

/** Prüft eine IANA-Zeitzone; ungültige werden durch UTC ersetzt. */
export function safeTimeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Kalendertag (YYYY-MM-DD) eines Zeitpunkts in einer Zeitzone. */
export function dayInZone(ms: number, timeZone: string): string {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  const parts = f.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Verschiebt einen Kalendertag um Tage bzw. Monate (UTC-Arithmetik, kein DST-Problem). */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(day: string, months: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  const target = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(target, last));
  return d.toISOString().slice(0, 10);
}

/** Löst eine Datumsangabe im Filter in einen Kalendertag auf. */
export function resolveDateOperand(op: DateOperand, now: Date, timeZone: string): string {
  if (op.kind === 'exact') return op.date;
  const today = dayInZone(now.getTime(), timeZone);
  switch (op.preset) {
    case 'today':
      return today;
    case 'tomorrow':
      return addDays(today, 1);
    case 'yesterday':
      return addDays(today, -1);
    case 'one_week_ago':
      return addDays(today, -7);
    case 'one_week_from_now':
      return addDays(today, 7);
    case 'one_month_ago':
      return addMonths(today, -1);
    case 'one_month_from_now':
      return addMonths(today, 1);
  }
}

/** Zeitraum relativ zu heute als [von, bis] (inklusive). */
export function resolveDateRange(range: DateRange, now: Date, timeZone: string): [string, string] {
  const today = dayInZone(now.getTime(), timeZone);
  switch (range) {
    case 'past_week':
      return [addDays(today, -7), today];
    case 'past_month':
      return [addMonths(today, -1), today];
    case 'past_year':
      return [addMonths(today, -12), today];
    case 'next_week':
      return [today, addDays(today, 7)];
    case 'next_month':
      return [today, addMonths(today, 1)];
    case 'next_year':
      return [today, addMonths(today, 12)];
  }
}

/**
 * Kalendertag eines gespeicherten Datums: mit Uhrzeit in der Zeitzone des Betrachters,
 * ganztägig unverändert (gespeichert als Mitternacht UTC).
 */
export function valueDay(ms: number, hasTime: boolean, timeZone: string): string {
  return dayInZone(ms, hasTime ? timeZone : 'UTC');
}
