import { createHash } from 'node:crypto';
import ICAL from 'ical.js';
import {
  ConnectorError,
  type DateField,
  type ExternalRecord,
  type FieldValue,
  type RecordKind,
  type SourceOptions,
} from './sdk';

type Component = InstanceType<typeof ICAL.Component>;
type Time = InstanceType<typeof ICAL.Time>;

/** Höchstzahl Einzeltermine je Serie (Schutz vor Endlosregeln) */
const MAX_OCCURRENCES = 2000;
/** Höchstzahl Datensätze je Datei */
const MAX_RECORDS = 50_000;
const DAY_MS = 86_400_000;

export interface ParseIcsOptions {
  /** Kennung der Quelle, Teil der schwachen ID bei fehlender UID */
  sourceKey: string;
  remoteRef?: string | null;
  /** Zeitzone für Zeiten ohne Zone und unbekannte TZIDs */
  timeZone: string;
  now: number;
  options: SourceOptions;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function recordVersion(kind: RecordKind, fields: Record<string, FieldValue>): string {
  return sha(JSON.stringify([kind, fields])).slice(0, 32);
}

// ------------------------------------------------------------------ Zeitzonen

const zoneValid = new Map<string, boolean>();
function validZone(tz: string): boolean {
  let ok = zoneValid.get(tz);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      ok = true;
    } catch {
      ok = false;
    }
    zoneValid.set(tz, ok);
  }
  return ok;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
/** Abstand der Zone zu UTC in ms zum Zeitpunkt ms. */
function zoneOffset(ms: number, tz: string): number {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(ms))) p[part.type] = Number(part.value);
  const local = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return local - Math.floor(ms / 1000) * 1000;
}

/** Ortszeit (Wanduhr) in einer IANA-Zone nach UTC-ms. */
export function zonedToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  tz: string,
): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const o1 = zoneOffset(wall - zoneOffset(wall, tz), tz);
  let ts = wall - o1;
  const o2 = zoneOffset(ts, tz);
  if (o2 !== o1) ts = wall - o2;
  return ts;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const dayString = (t: Time) => `${pad(t.year, 4)}-${pad(t.month)}-${pad(t.day)}`;

interface TimeContext {
  /** In der Datei definierte Zonen (VTIMEZONE) */
  local: Map<string, InstanceType<typeof ICAL.Timezone>>;
  fallback: string;
}

/** Zeitpunkt in UTC-ms; tzid aus dem Parameter der Eigenschaft. */
function timeMs(t: Time, tzid: string | null, ctx: TimeContext): number {
  const isUtc = t.zone?.tzid === 'UTC' || tzid === 'UTC' || tzid === 'Etc/UTC';
  if (isUtc) return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  if (tzid && validZone(tzid))
    return zonedToUtc(t.year, t.month, t.day, t.hour, t.minute, t.second, tzid);
  const vtz = tzid ? ctx.local.get(tzid) : undefined;
  if (vtz) {
    const c = t.clone();
    c.zone = vtz;
    return c.toUnixTime() * 1000;
  }
  return zonedToUtc(t.year, t.month, t.day, t.hour, t.minute, t.second, ctx.fallback);
}

function timeValue(
  t: Time,
  tzid: string | null,
  ctx: TimeContext,
): { value: string; hasTime: boolean } {
  if (t.isDate) return { value: dayString(t), hasTime: false };
  return { value: new Date(timeMs(t, tzid, ctx)).toISOString(), hasTime: true };
}

function propTime(comp: Component, name: string): { time: Time; tzid: string | null } | null {
  const prop = comp.getFirstProperty(name);
  if (!prop) return null;
  const v = prop.getFirstValue();
  if (!v || typeof v !== 'object' || !('isDate' in v)) return null;
  const tzid = prop.getParameter('tzid');
  return { time: v as Time, tzid: typeof tzid === 'string' ? tzid : null };
}

/** Zeitraum aus Beginn und (exklusivem) Ende. Ganztägig: Ende einen Tag früher. */
function range(
  start: { value: string; hasTime: boolean },
  end: { value: string; hasTime: boolean } | null,
): DateField {
  let e: string | null = null;
  if (end && end.hasTime === start.hasTime) {
    if (start.hasTime) e = end.value > start.value ? end.value : null;
    else {
      const last = new Date(Date.parse(`${end.value}T00:00:00Z`) - DAY_MS)
        .toISOString()
        .slice(0, 10);
      e = last > start.value ? last : null;
    }
  }
  return { start: start.value, end: e, hasTime: start.hasTime };
}

// ------------------------------------------------------------------ Felder

function text(comp: Component, name: string): string | null {
  const v = comp.getFirstPropertyValue(name);
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function categories(comp: Component): string[] {
  const out: string[] = [];
  for (const p of comp.getAllProperties('categories'))
    for (const v of p.getValues()) {
      for (const part of String(v).split(',')) {
        const s = part.trim();
        if (s && !out.includes(s)) out.push(s);
      }
    }
  return out;
}

function organizer(comp: Component): string | null {
  const p = comp.getFirstProperty('organizer');
  if (!p) return null;
  const cn = p.getParameter('cn');
  if (typeof cn === 'string' && cn.trim()) return cn.trim();
  const v = p.getFirstValue();
  return v ? String(v).replace(/^mailto:/i, '') : null;
}

function url(comp: Component): string | null {
  const u = text(comp, 'url');
  return u && /^https?:\/\//i.test(u) ? u : null;
}

function eventFields(
  comp: Component,
  start: { value: string; hasTime: boolean },
  end: { value: string; hasTime: boolean } | null,
): Record<string, FieldValue> {
  const date = range(start, end);
  return {
    title: text(comp, 'summary') ?? '',
    description: text(comp, 'description'),
    date,
    start: date.start,
    end: date.end,
    allDay: !date.hasTime,
    location: text(comp, 'location'),
    organizer: organizer(comp),
    url: url(comp),
    categories: categories(comp),
    status: text(comp, 'status')?.toLowerCase() ?? null,
  };
}

function taskFields(comp: Component, ctx: TimeContext): Record<string, FieldValue> {
  const s = propTime(comp, 'dtstart');
  const d = propTime(comp, 'due');
  const start = s ? timeValue(s.time, s.tzid, ctx) : null;
  const due = d ? timeValue(d.time, d.tzid, ctx) : null;
  let date: DateField | null = null;
  if (due && start && start.hasTime === due.hasTime && due.value > start.value)
    date = { start: start.value, end: due.value, hasTime: due.hasTime };
  else if (due) date = { start: due.value, end: null, hasTime: due.hasTime };
  else if (start) date = { start: start.value, end: null, hasTime: start.hasTime };
  const status = text(comp, 'status')?.toLowerCase() ?? null;
  const prio = Number(comp.getFirstPropertyValue('priority'));
  return {
    title: text(comp, 'summary') ?? '',
    description: text(comp, 'description'),
    date,
    due: due?.value ?? null,
    completed: status === 'completed' || comp.hasProperty('completed'),
    priority: Number.isInteger(prio) && prio > 0 ? prio : null,
    categories: categories(comp),
    status,
    url: url(comp),
  };
}

// ------------------------------------------------------------------ Parsen

function rootComponents(ics: string): Component[] {
  let jcal: unknown;
  try {
    jcal = ICAL.parse(ics);
  } catch (err) {
    throw new ConnectorError('protocol', `Ungültige iCalendar-Daten: ${(err as Error).message}`);
  }
  // Mehrere VCALENDAR in einer Datei ergeben ein Array von Komponenten
  const list = Array.isArray(jcal) && Array.isArray(jcal[0]) ? (jcal as unknown[]) : [jcal];
  return list.map((j) => new ICAL.Component(j as never));
}

function ridKey(t: Time, tzid: string | null, ctx: TimeContext): string {
  return t.isDate ? dayString(t) : new Date(timeMs(t, tzid, ctx)).toISOString();
}

/**
 * Liest VEVENT und VTODO aus iCalendar-Text. Serien werden je nach Optionen im Zeitfenster in
 * Einzeltermine aufgeteilt (ID: UID#RECURRENCE-ID) oder als eine Zeile geliefert.
 */
export function parseIcs(ics: string, opts: ParseIcsOptions): ExternalRecord[] {
  const roots = rootComponents(ics);
  const ctx: TimeContext = { local: new Map(), fallback: opts.timeZone };
  for (const root of roots)
    for (const vtz of root.getAllSubcomponents('vtimezone')) {
      const id = vtz.getFirstPropertyValue('tzid');
      if (id) ctx.local.set(String(id), new ICAL.Timezone(vtz));
    }

  const out: ExternalRecord[] = [];
  const seen = new Set<string>();
  const push = (r: Omit<ExternalRecord, 'version' | 'remoteRef'>) => {
    if (seen.has(r.externalId) || out.length >= MAX_RECORDS) return;
    seen.add(r.externalId);
    out.push({ ...r, remoteRef: opts.remoteRef ?? null, version: recordVersion(r.kind, r.fields) });
  };
  const weak = (comp: Component, kind: RecordKind) =>
    `weak:${sha(
      [
        opts.sourceKey,
        kind,
        comp.getFirstProperty('dtstart')?.toICALString() ?? '',
        text(comp, 'summary') ?? '',
      ].join('\u0000'),
    ).slice(0, 40)}`;

  const windowStart = opts.now - opts.options.windowPastDays * DAY_MS;
  const windowEnd = opts.now + opts.options.windowFutureDays * DAY_MS;

  for (const root of roots) {
    // Ausnahmen (RECURRENCE-ID) nach UID sammeln
    const events = root.getAllSubcomponents('vevent');
    const masters = new Map<string, Component>();
    const exceptions = new Map<string, Component[]>();
    for (const ev of events) {
      const uid = text(ev, 'uid');
      if (!uid) continue;
      if (ev.hasProperty('recurrence-id'))
        exceptions.set(uid, [...(exceptions.get(uid) ?? []), ev]);
      else if (!masters.has(uid)) masters.set(uid, ev);
    }

    for (const ev of events) {
      if (ev.hasProperty('recurrence-id')) continue;
      const uid = text(ev, 'uid');
      const st = propTime(ev, 'dtstart');
      if (!st) continue;
      const startTzid = st.tzid;
      const recurring = ev.hasProperty('rrule') || ev.hasProperty('rdate');

      if (!recurring || !opts.options.expandRecurring || !uid) {
        const start = timeValue(st.time, startTzid, ctx);
        const en = propTime(ev, 'dtend');
        let end = en ? timeValue(en.time, en.tzid, ctx) : null;
        if (!en) {
          const dur = ev.getFirstPropertyValue('duration');
          if (dur && typeof dur === 'object' && 'toSeconds' in dur) {
            const t = st.time.clone();
            t.addDuration(dur as InstanceType<typeof ICAL.Duration>);
            end = timeValue(t, startTzid, ctx);
          }
        }
        push({
          externalId: uid ?? weak(ev, 'event'),
          weakId: !uid,
          kind: 'event',
          fields: eventFields(ev, start, end),
        });
        continue;
      }

      // Serie: Einzeltermine im Zeitfenster
      const event = new ICAL.Event(ev, {
        strictExceptions: true,
        exceptions: exceptions.get(uid) ?? [],
      });
      const it = event.iterator();
      let n = 0;
      for (let next = it.next(); next && n < MAX_OCCURRENCES; next = it.next()) {
        const occ = event.getOccurrenceDetails(next);
        const sMs = occ.startDate.isDate
          ? Date.parse(`${dayString(occ.startDate)}T00:00:00Z`)
          : timeMs(occ.startDate, startTzid, ctx);
        if (sMs > windowEnd) break;
        const eMs = occ.endDate.isDate
          ? Date.parse(`${dayString(occ.endDate)}T00:00:00Z`)
          : timeMs(occ.endDate, startTzid, ctx);
        if (Math.max(eMs, sMs) < windowStart) continue;
        n++;
        const item = occ.item.component;
        const itemTz = item === ev ? startTzid : (propTime(item, 'dtstart')?.tzid ?? startTzid);
        const itemEndTz =
          item === ev
            ? (propTime(ev, 'dtend')?.tzid ?? startTzid)
            : (propTime(item, 'dtend')?.tzid ?? itemTz);
        push({
          externalId: `${uid}#${ridKey(occ.recurrenceId, startTzid, ctx)}`,
          weakId: false,
          kind: 'event',
          fields: eventFields(
            item,
            timeValue(occ.startDate, itemTz, ctx),
            timeValue(occ.endDate, itemEndTz, ctx),
          ),
        });
      }
    }

    // Ausnahmen ohne Serie in der Datei (z. B. einzelne Ressource auf dem CalDAV-Server)
    for (const [uid, list] of exceptions) {
      if (masters.has(uid)) continue;
      for (const ex of list) {
        const st = propTime(ex, 'dtstart');
        const rid = propTime(ex, 'recurrence-id');
        if (!st || !rid) continue;
        const en = propTime(ex, 'dtend');
        push({
          externalId: `${uid}#${ridKey(rid.time, rid.tzid, ctx)}`,
          weakId: false,
          kind: 'event',
          fields: eventFields(
            ex,
            timeValue(st.time, st.tzid, ctx),
            en ? timeValue(en.time, en.tzid, ctx) : null,
          ),
        });
      }
    }

    for (const todo of root.getAllSubcomponents('vtodo')) {
      const uid = text(todo, 'uid');
      const rid = propTime(todo, 'recurrence-id');
      push({
        externalId: uid
          ? rid
            ? `${uid}#${ridKey(rid.time, rid.tzid, ctx)}`
            : uid
          : weak(todo, 'task'),
        weakId: !uid,
        kind: 'task',
        fields: taskFields(todo, ctx),
      });
    }
  }
  return out;
}
