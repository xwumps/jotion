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
 * Phase 11: Google (Kalender, Gmail nur lesend, Drive nur Metadaten) über die REST-APIs mit
 * OAuth. Quellen: jeder Kalender, Gmail-Posteingang und markierte Nachrichten, Google Drive.
 */

const SERVICE = 'Google';
const base = (ctx: ConnectorContext) => endpoint(ctx, 'google', 'https://www.googleapis.com');

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];

const num = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

// ------------------------------------------------------------------ Kalender

interface GEventTime {
  date?: string;
  dateTime?: string;
}
interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: GEventTime;
  end?: GEventTime;
  organizer?: { email?: string; displayName?: string };
}

const minusDay = (d: string) =>
  new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** Zeitraum eines Termins; ganztägige Enden sind exklusiv und werden auf den letzten Tag gesetzt */
export function googleEventDate(start?: GEventTime, end?: GEventTime): DateField | null {
  if (start?.date) {
    const last = end?.date ? minusDay(end.date) : null;
    return { start: start.date, end: last && last > start.date ? last : null, hasTime: false };
  }
  if (start?.dateTime) {
    const s = new Date(start.dateTime).toISOString();
    const e = end?.dateTime ? new Date(end.dateTime).toISOString() : null;
    return { start: s, end: e && e !== s ? e : null, hasTime: true };
  }
  return null;
}

async function pullCalendar(
  ctx: ConnectorContext,
  calendarId: string,
  options: SourceOptions,
): Promise<PullResult> {
  const { from, to } = windowBounds(ctx, options.windowPastDays, options.windowFutureDays);
  const records: ExternalRecord[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const u = new URL(
      `${base(ctx)}/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    );
    u.searchParams.set('timeMin', from);
    u.searchParams.set('timeMax', to);
    u.searchParams.set('maxResults', '250');
    u.searchParams.set('singleEvents', options.expandRecurring ? 'true' : 'false');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const { data } = await apiJson<{ items?: GEvent[]; nextPageToken?: string }>(
      ctx,
      SERVICE,
      u.toString(),
    );
    for (const e of data.items ?? []) {
      if (e.status === 'cancelled') continue;
      const date = googleEventDate(e.start, e.end);
      if (!date) continue;
      records.push(
        record('event', e.id, {
          title: e.summary ?? '',
          description: e.description ?? null,
          date,
          start: date.start,
          end: date.end,
          allDay: !date.hasTime,
          location: e.location ?? null,
          organizer: e.organizer?.displayName ?? e.organizer?.email ?? null,
          url: e.htmlLink ?? null,
          categories: [],
          status: e.status ?? null,
        }),
      );
    }
    pageToken = data.nextPageToken ?? null;
    if (!pageToken) break;
  }
  // Vollständiger Bestand im Zeitfenster (wie beim iCal-Feed)
  return {
    records,
    deletedRefs: [],
    refreshedRefs: [],
    complete: true,
    windowStart: from,
    cursor: { day: today(ctx) },
  };
}

// ------------------------------------------------------------------ Gmail

interface GMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: { name: string; value: string }[] };
}

const HIDDEN_LABELS = /^(UNREAD|INBOX|IMPORTANT|STARRED|SENT|DRAFT|SPAM|TRASH|CHAT|CATEGORY_.*)$/;

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function gmailRecord(m: GMessage): ExternalRecord {
  const header = (name: string) =>
    m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
  const labels = m.labelIds ?? [];
  const ms = Number(m.internalDate);
  return record('message', m.id, {
    title: header('Subject')?.trim() || '(ohne Betreff)',
    description: m.snippet ? decodeEntities(m.snippet) : null,
    date: Number.isFinite(ms) ? instant(new Date(ms).toISOString()) : null,
    from: header('From'),
    to: header('To'),
    categories: labels.filter((l) => !HIDDEN_LABELS.test(l)),
    read: !labels.includes('UNREAD'),
    url: `https://mail.google.com/mail/u/0/#all/${m.threadId}`,
  });
}

async function fetchMessages(ctx: ConnectorContext, ids: string[]): Promise<ExternalRecord[]> {
  const out: ExternalRecord[] = [];
  for (const id of ids) {
    const u = new URL(`${base(ctx)}/gmail/v1/users/me/messages/${encodeURIComponent(id)}`);
    u.searchParams.set('format', 'metadata');
    for (const h of ['Subject', 'From', 'To', 'Date']) u.searchParams.append('metadataHeaders', h);
    const { status, data } = await apiJson<GMessage>(ctx, SERVICE, u.toString(), { accept: [404] });
    // Inzwischen gelöscht: kommt als Löschung über die Historie
    if (status === 404) continue;
    out.push(gmailRecord(data));
  }
  return out;
}

type GmailCursor = { historyId?: string };

async function pullGmail(
  ctx: ConnectorContext,
  label: string,
  cursor: GmailCursor | null,
): Promise<PullResult> {
  if (cursor?.historyId) {
    const changed = new Set<string>();
    const deleted = new Set<string>();
    let pageToken: string | null = null;
    let historyId = cursor.historyId;
    let expired = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const u = new URL(`${base(ctx)}/gmail/v1/users/me/history`);
      u.searchParams.set('startHistoryId', cursor.historyId);
      u.searchParams.set('labelId', label);
      for (const t of ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'])
        u.searchParams.append('historyTypes', t);
      if (pageToken) u.searchParams.set('pageToken', pageToken);
      const { status, data } = await apiJson<{
        history?: {
          messagesAdded?: { message: GMessage }[];
          messagesDeleted?: { message: GMessage }[];
          labelsAdded?: { message: GMessage; labelIds: string[] }[];
          labelsRemoved?: { message: GMessage; labelIds: string[] }[];
        }[];
        historyId?: string;
        nextPageToken?: string;
      }>(ctx, SERVICE, u.toString(), { accept: [404] });
      // Historie zu alt: vollständiger Abruf
      if (status === 404) {
        expired = true;
        break;
      }
      for (const h of data.history ?? []) {
        for (const a of h.messagesAdded ?? []) {
          changed.add(a.message.id);
          deleted.delete(a.message.id);
        }
        for (const d of h.messagesDeleted ?? []) {
          deleted.add(d.message.id);
          changed.delete(d.message.id);
        }
        for (const l of h.labelsAdded ?? []) changed.add(l.message.id);
        for (const l of h.labelsRemoved ?? []) {
          if (l.labelIds.includes(label)) {
            deleted.add(l.message.id);
            changed.delete(l.message.id);
          } else changed.add(l.message.id);
        }
      }
      if (data.historyId) historyId = data.historyId;
      pageToken = data.nextPageToken ?? null;
      if (!pageToken) break;
    }
    if (!expired) {
      // Nachrichten ohne das Label der Quelle (z. B. archiviert) gelten als entfernt
      const records = await fetchMessages(ctx, [...changed]);
      return {
        records,
        deletedRefs: [...deleted],
        refreshedRefs: [],
        complete: false,
        cursor: { historyId },
      };
    }
  }
  // Vollständig: Stand der Historie vor dem Abruf merken, dann die neuesten Nachrichten
  const max = num(ctx.config.maxMessages, 200);
  const { data: profile } = await apiJson<{ historyId: string; emailAddress?: string }>(
    ctx,
    SERVICE,
    `${base(ctx)}/gmail/v1/users/me/profile`,
  );
  const ids: string[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < MAX_PAGES && ids.length < max; page++) {
    const u = new URL(`${base(ctx)}/gmail/v1/users/me/messages`);
    u.searchParams.set('labelIds', label);
    u.searchParams.set('maxResults', String(Math.min(100, max - ids.length)));
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const { data } = await apiJson<{ messages?: { id: string }[]; nextPageToken?: string }>(
      ctx,
      SERVICE,
      u.toString(),
    );
    ids.push(...(data.messages ?? []).map((m) => m.id));
    pageToken = data.nextPageToken ?? null;
    if (!pageToken) break;
  }
  const records = await fetchMessages(ctx, ids.slice(0, max));
  // Ältere Nachrichten jenseits der Höchstzahl bleiben bestehen: nicht vollständig
  return {
    records,
    deletedRefs: [],
    refreshedRefs: [],
    complete: false,
    cursor: { historyId: profile.historyId },
  };
}

// ------------------------------------------------------------------ Drive

interface GFile {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  trashed?: boolean;
}

const FOLDER = 'application/vnd.google-apps.folder';
const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,webViewLink,trashed';

export function driveRecord(f: GFile): ExternalRecord {
  return record('file', f.id, {
    title: f.name ?? '',
    path: null,
    size: f.size ? Number(f.size) : null,
    mime: f.mimeType ?? null,
    date: instant(f.modifiedTime),
    url: f.webViewLink ?? null,
  });
}

type DriveCursor = { pageToken?: string };

async function pullDrive(ctx: ConnectorContext, cursor: DriveCursor | null): Promise<PullResult> {
  if (cursor?.pageToken) {
    const records: ExternalRecord[] = [];
    const deletedRefs: string[] = [];
    let token = cursor.pageToken;
    let next: string | null = token;
    for (let page = 0; page < MAX_PAGES && next; page++) {
      const u = new URL(`${base(ctx)}/drive/v3/changes`);
      u.searchParams.set('pageToken', next);
      u.searchParams.set('pageSize', '1000');
      u.searchParams.set(
        'fields',
        `nextPageToken,newStartPageToken,changes(removed,fileId,file(${FILE_FIELDS}))`,
      );
      const { data } = await apiJson<{
        changes?: { removed?: boolean; fileId: string; file?: GFile }[];
        nextPageToken?: string;
        newStartPageToken?: string;
      }>(ctx, SERVICE, u.toString());
      for (const c of data.changes ?? []) {
        if (c.removed || !c.file || c.file.trashed) deletedRefs.push(c.fileId);
        else if (c.file.mimeType !== FOLDER) records.push(driveRecord(c.file));
      }
      if (data.newStartPageToken) token = data.newStartPageToken;
      next = data.nextPageToken ?? null;
    }
    return {
      records,
      deletedRefs,
      refreshedRefs: [],
      complete: false,
      cursor: { pageToken: token },
    };
  }
  const { data: start } = await apiJson<{ startPageToken: string }>(
    ctx,
    SERVICE,
    `${base(ctx)}/drive/v3/changes/startPageToken`,
  );
  const max = num(ctx.config.maxFiles, 5000);
  const records: ExternalRecord[] = [];
  let pageToken: string | null = null;
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const u = new URL(`${base(ctx)}/drive/v3/files`);
    u.searchParams.set('q', `trashed = false and mimeType != '${FOLDER}'`);
    u.searchParams.set('pageSize', '1000');
    u.searchParams.set('fields', `nextPageToken,files(${FILE_FIELDS})`);
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const { data } = await apiJson<{ files?: GFile[]; nextPageToken?: string }>(
      ctx,
      SERVICE,
      u.toString(),
    );
    for (const f of data.files ?? []) records.push(driveRecord(f));
    pageToken = data.nextPageToken ?? null;
    if (records.length >= max) {
      truncated = !!pageToken || records.length > max;
      break;
    }
    if (!pageToken) break;
  }
  return {
    records: records.slice(0, max),
    deletedRefs: [],
    refreshedRefs: [],
    complete: !truncated,
    cursor: { pageToken: start.startPageToken },
  };
}

// ------------------------------------------------------------------ Connector

async function discover(ctx: ConnectorContext): Promise<ExternalSource[]> {
  const { data } = await apiJson<{
    items?: { id: string; summary?: string; summaryOverride?: string; backgroundColor?: string }[];
  }>(ctx, SERVICE, `${base(ctx)}/calendar/v3/users/me/calendarList`);
  const calendars: ExternalSource[] = (data.items ?? []).map((c) => ({
    remoteId: `calendar:${c.id}`,
    name: c.summaryOverride ?? c.summary ?? c.id,
    kinds: ['event'],
    meta: { color: c.backgroundColor ?? null },
  }));
  return [
    ...calendars,
    { remoteId: 'gmail:INBOX', name: 'Gmail: Posteingang', kinds: ['message'] },
    { remoteId: 'gmail:STARRED', name: 'Gmail: Markiert', kinds: ['message'] },
    { remoteId: 'drive', name: 'Google Drive', kinds: ['file'] },
  ];
}

export const googleConnector: ConnectorDefinition = {
  type: 'google',
  displayName: 'Google',
  authKind: 'oauth2',
  oauth: { provider: 'google', scopes: GOOGLE_SCOPES },
  configFields: ['maxMessages', 'maxFiles'],
  secretFields: [],
  capabilities: { kinds: ['event', 'message', 'file'], incremental: true, write: false },
  validateConfig(config) {
    return {
      maxMessages: num(config.maxMessages, 200),
      maxFiles: num(config.maxFiles, 5000),
      account: typeof config.account === 'string' ? config.account : null,
    };
  },
  async testConnection(ctx) {
    const { data } = await apiJson<{ email?: string; name?: string }>(
      ctx,
      SERVICE,
      `${base(ctx)}/oauth2/v3/userinfo`,
    );
    const sources = await discover(ctx);
    return {
      accountLabel: data.email ?? data.name ?? 'Google',
      sources,
      capabilities: { calendar: true, gmail: true, drive: true, incremental: true },
    };
  },
  discoverSources: discover,
  pull(ctx, source, cursor) {
    const id = source.remoteId;
    if (id.startsWith('calendar:')) return pullCalendar(ctx, id.slice(9), source.options);
    if (id.startsWith('gmail:')) return pullGmail(ctx, id.slice(6), cursor as GmailCursor | null);
    if (id === 'drive') return pullDrive(ctx, cursor as DriveCursor | null);
    throw new ConnectorError('config', `Unbekannte Google-Quelle: ${id}`);
  },
};
