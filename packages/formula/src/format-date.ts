import { zonedParts } from './values';

const MONTHS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];
const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/**
 * Datum formatieren mit Moment-ähnlichen Kürzeln (wie Notion):
 * YYYY YY · MMMM MMM MM M · DD D · dddd ddd · HH H hh h · mm m · ss s · A a · Text in [eckigen Klammern].
 * Englische Namen mit dem Präfix "en:" (z. B. "en:MMMM D, YYYY").
 */
export function formatDate(ms: number, pattern: string, timeZone: string): string {
  const en = pattern.startsWith('en:');
  const fmt = en ? pattern.slice(3) : pattern;
  const p = zonedParts(ms, timeZone);
  const months = en ? MONTHS_EN : MONTHS;
  const days = en ? DAYS_EN : DAYS;
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const tokens: Record<string, string> = {
    YYYY: String(p.year),
    YY: pad(p.year % 100),
    MMMM: months[p.month - 1]!,
    MMM: months[p.month - 1]!.slice(0, 3),
    MM: pad(p.month),
    M: String(p.month),
    DD: pad(p.day),
    D: String(p.day),
    dddd: days[p.weekday]!,
    ddd: days[p.weekday]!.slice(0, en ? 3 : 2),
    HH: pad(p.hour),
    H: String(p.hour),
    hh: pad(h12),
    h: String(h12),
    mm: pad(p.minute),
    m: String(p.minute),
    ss: pad(p.second),
    s: String(p.second),
    A: p.hour < 12 ? 'AM' : 'PM',
    a: p.hour < 12 ? 'am' : 'pm',
  };
  return fmt
    .replace(
      /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|A|a/g,
      (m, lit) => (lit !== undefined ? lit : tokens[m]!),
    )
    .slice(0, 1000);
}
