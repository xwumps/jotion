import { apiJson, endpoint, instant, MAX_PAGES, record, today, windowBounds } from './rest';
import {
  ConnectorError,
  type ConnectorContext,
  type ConnectorDefinition,
  type DateField,
  type ExternalRecord,
  type ExternalSource,
  type PullResult,
  type SourceOptions,
} from './sdk';

/**
 * Phase 11: Microsoft 365 und Outlook.com über Microsoft Graph mit Delta-Abfragen:
 * Kalender (calendarView/delta im Zeitfenster), Outlook-Posteingang, OneDrive.
 */

const SERVICE = 'Microsoft';
const base = (ctx: ConnectorContext) =>
  endpoint(ctx, 'microsoft', 'https://graph.microsoft.com/v1.0');

export const MICROSOFT_SCOPES = ['Calendars.Read', 'Mail.Read', 'Files.Read'];

type DeltaCursor = { deltaLink?: string; day?: string };

interface DeltaPage<T> {
  value?: (T & { '@removed'?: unknown; id: string })[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

/**
 * Folgt einer Delta-Abfrage bis zum deltaLink. null bedeutet: Delta-Stand ungültig (410), neu
 * vollständig abrufen.
 */
async function delta<T>(
  ctx: ConnectorContext,
  url: string,
  headers: Record<string, string>,
): Promise<{ items: (T & { id: string })[]; removed: string[]; deltaLink: string | null } | null> {
  const items: (T & { id: string })[] = [];
  const removed: string[] = [];
  let next: string | null = url;
  let deltaLink: string | null = null;
  for (let page = 0; page < MAX_PAGES && next; page++) {
    const { status, data }: { status: number; data: DeltaPage<T> } = await apiJson<DeltaPage<T>>(
      ctx,
      SERVICE,
      next,
      { headers, accept: [410] },
    );
    if (status === 410) return null;
    for (const v of data.value ?? []) {
      if (v['@removed'] !== undefined) removed.push(v.id);
      else items.push(v);
    }
    next = data['@odata.nextLink'] ?? null;
    deltaLink = data['@odata.deltaLink'] ?? deltaLink;
  }
  return { items, removed, deltaLink };
}

// ------------------------------------------------------------------ Kalender

interface MsTime {
  dateTime?: string;
  timeZone?: string;
}
interface MsEvent {
  subject?: string;
  bodyPreview?: string;
  start?: MsTime;
  end?: MsTime;
  isAllDay?: boolean;
  isCancelled?: boolean;
  location?: { displayName?: string };
  organizer?: { emailAddress?: { name?: string; address?: string } };
  webLink?: string;
  categories?: string[];
  showAs?: string;
}

/** Graph liefert mit Prefer outlook.timezone="UTC" Zeiten ohne Zone in UTC */
const utc = (t?: MsTime) =>
  t?.dateTime
    ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(t.dateTime) ? t.dateTime : `${t.dateTime}Z`)
    : null;

export function msEventDate(e: MsEvent): DateField | null {
  const s = utc(e.start);
  if (!s || Number.isNaN(s.getTime())) return null;
  const en = utc(e.end);
  if (e.isAllDay) {
    const start = s.toISOString().slice(0, 10);
    // Ende ist exklusiv (Mitternacht des Folgetags)
    const last = en ? new Date(en.getTime() - 86_400_000).toISOString().slice(0, 10) : null;
    return { start, end: last && last > start ? last : null, hasTime: false };
  }
  const end = en && !Number.isNaN(en.getTime()) ? en.toISOString() : null;
  return { start: s.toISOString(), end: end !== s.toISOString() ? end : null, hasTime: true };
}

function eventRecord(e: MsEvent & { id: string }): ExternalRecord | null {
  if (e.isCancelled) return null;
  const date = msEventDate(e);
  if (!date) return null;
  return record('event', e.id, {
    title: e.subject ?? '',
    description: e.bodyPreview || null,
    date,
    start: date.start,
    end: date.end,
    allDay: !date.hasTime,
    location: e.location?.displayName || null,
    organizer: e.organizer?.emailAddress?.name ?? e.organizer?.emailAddress?.address ?? null,
    url: e.webLink ?? null,
    categories: e.categories ?? [],
    status: e.showAs ?? null,
  });
}

const PREFER = { Prefer: 'outlook.timezone="UTC", odata.maxpagesize=200' };

async function pullDelta<T>(
  ctx: ConnectorContext,
  initialUrl: string,
  cursor: DeltaCursor | null,
  toRecord: (item: T & { id: string }) => ExternalRecord | null,
  opts: { dayBound: boolean; completeOnFull: boolean; windowStart?: string },
): Promise<PullResult> {
  const day = today(ctx);
  // Zeitfenster wandert täglich: dann vollständig neu (wie bei CalDAV)
  const useDelta = cursor?.deltaLink && (!opts.dayBound || cursor.day === day);
  if (useDelta) {
    const r = await delta<T>(ctx, cursor!.deltaLink!, PREFER);
    if (r) {
      const records: ExternalRecord[] = [];
      const removed = [...r.removed];
      for (const item of r.items) {
        const rec = toRecord(item);
        if (rec) records.push(rec);
        // Abgesagt oder Ordner zu Datei geworden: wie entfernt
        else removed.push(item.id);
      }
      return {
        records,
        deletedRefs: removed,
        refreshedRefs: [],
        complete: false,
        cursor: { deltaLink: r.deltaLink ?? cursor!.deltaLink, day },
      };
    }
  }
  const r = await delta<T>(ctx, initialUrl, PREFER);
  if (!r) throw new ConnectorError('protocol', `${SERVICE}: Delta-Abfrage nicht möglich`);
  const records = r.items.map(toRecord).filter((x): x is ExternalRecord => x !== null);
  return {
    records,
    deletedRefs: [],
    refreshedRefs: [],
    complete: opts.completeOnFull,
    windowStart: opts.windowStart,
    cursor: { deltaLink: r.deltaLink, day },
  };
}

function pullCalendar(
  ctx: ConnectorContext,
  calendarId: string,
  options: SourceOptions,
  cursor: DeltaCursor | null,
) {
  const { from, to } = windowBounds(ctx, options.windowPastDays, options.windowFutureDays);
  const u = new URL(
    `${base(ctx)}/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta`,
  );
  u.searchParams.set('startDateTime', from);
  u.searchParams.set('endDateTime', to);
  return pullDelta<MsEvent>(ctx, u.toString(), cursor, eventRecord, {
    dayBound: true,
    completeOnFull: true,
    windowStart: from,
  });
}

// ------------------------------------------------------------------ Outlook

interface MsMessage {
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: { emailAddress?: { name?: string; address?: string } }[];
  isRead?: boolean;
  webLink?: string;
  categories?: string[];
}

const addr = (a?: { name?: string; address?: string }) =>
  a ? (a.name && a.address ? `${a.name} <${a.address}>` : (a.address ?? a.name ?? null)) : null;

export function outlookRecord(m: MsMessage & { id: string }): ExternalRecord {
  return record('message', m.id, {
    title: m.subject?.trim() || '(ohne Betreff)',
    description: m.bodyPreview || null,
    date: instant(m.receivedDateTime),
    from: addr(m.from?.emailAddress),
    to:
      (m.toRecipients ?? [])
        .map((r) => addr(r.emailAddress))
        .filter(Boolean)
        .join(', ') || null,
    categories: m.categories ?? [],
    read: m.isRead ?? false,
    url: m.webLink ?? null,
  });
}

function pullMail(ctx: ConnectorContext, folder: string, cursor: DeltaCursor | null) {
  const days = Number(ctx.config.mailDays) > 0 ? Number(ctx.config.mailDays) : 30;
  const since = new Date(ctx.now() - days * 86_400_000).toISOString();
  const u = new URL(`${base(ctx)}/me/mailFolders/${encodeURIComponent(folder)}/messages/delta`);
  u.searchParams.set(
    '$select',
    'subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,webLink,categories',
  );
  u.searchParams.set('$filter', `receivedDateTime ge ${since}`);
  // Ältere Nachrichten außerhalb des Zeitraums bleiben bestehen: nie vollständig
  return pullDelta<MsMessage>(ctx, u.toString(), cursor, outlookRecord, {
    dayBound: false,
    completeOnFull: false,
  });
}

// ------------------------------------------------------------------ OneDrive

interface MsDriveItem {
  name?: string;
  size?: number;
  file?: { mimeType?: string };
  folder?: unknown;
  deleted?: unknown;
  lastModifiedDateTime?: string;
  webUrl?: string;
  parentReference?: { path?: string };
}

export function oneDriveRecord(f: MsDriveItem & { id: string }): ExternalRecord | null {
  if (f.folder || f.deleted || !f.file) return null;
  const parent = (f.parentReference?.path ?? '').replace(/^\/drive\/root:?/, '');
  return record('file', f.id, {
    title: f.name ?? '',
    path: `${parent}/${f.name ?? ''}`.replace(/^\/+/, '/'),
    size: typeof f.size === 'number' ? f.size : null,
    mime: f.file.mimeType ?? null,
    date: instant(f.lastModifiedDateTime),
    url: f.webUrl ?? null,
  });
}

function pullDrive(ctx: ConnectorContext, cursor: DeltaCursor | null) {
  const u = new URL(`${base(ctx)}/me/drive/root/delta`);
  u.searchParams.set(
    '$select',
    'id,name,size,file,folder,deleted,lastModifiedDateTime,webUrl,parentReference',
  );
  return pullDelta<MsDriveItem>(ctx, u.toString(), cursor, oneDriveRecord, {
    dayBound: false,
    completeOnFull: true,
  });
}

// ------------------------------------------------------------------ Connector

async function discover(ctx: ConnectorContext): Promise<ExternalSource[]> {
  const { data } = await apiJson<{ value?: { id: string; name?: string; hexColor?: string }[] }>(
    ctx,
    SERVICE,
    `${base(ctx)}/me/calendars`,
  );
  return [
    ...(data.value ?? []).map((c): ExternalSource => ({
      remoteId: `calendar:${c.id}`,
      name: c.name ?? c.id,
      kinds: ['event'],
      meta: { color: c.hexColor || null },
    })),
    { remoteId: 'mail:inbox', name: 'Outlook: Posteingang', kinds: ['message'] },
    { remoteId: 'onedrive', name: 'OneDrive', kinds: ['file'] },
  ];
}

export const microsoftConnector: ConnectorDefinition = {
  type: 'microsoft',
  displayName: 'Microsoft 365 / Outlook',
  authKind: 'oauth2',
  oauth: { provider: 'microsoft', scopes: MICROSOFT_SCOPES },
  configFields: ['mailDays'],
  secretFields: [],
  capabilities: { kinds: ['event', 'message', 'file'], incremental: true, write: false },
  validateConfig(config) {
    const d = Number(config.mailDays);
    return {
      mailDays: Number.isFinite(d) && d > 0 ? Math.min(365, Math.floor(d)) : 30,
      account: typeof config.account === 'string' ? config.account : null,
    };
  },
  async testConnection(ctx) {
    const { data } = await apiJson<{
      mail?: string;
      userPrincipalName?: string;
      displayName?: string;
    }>(ctx, SERVICE, `${base(ctx)}/me`);
    return {
      accountLabel: data.mail ?? data.userPrincipalName ?? data.displayName ?? 'Microsoft',
      sources: await discover(ctx),
      capabilities: { calendar: true, mail: true, onedrive: true, incremental: true },
    };
  },
  discoverSources: discover,
  pull(ctx, source, cursor) {
    const id = source.remoteId;
    const c = cursor as DeltaCursor | null;
    if (id.startsWith('calendar:')) return pullCalendar(ctx, id.slice(9), source.options, c);
    if (id.startsWith('mail:')) return pullMail(ctx, id.slice(5), c);
    if (id === 'onedrive') return pullDrive(ctx, c);
    throw new ConnectorError('config', `Unbekannte Microsoft-Quelle: ${id}`);
  },
};
