import { guard } from './guard';
import { recordVersion } from './ical';
import {
  ConnectorError,
  type ConnectorContext,
  type DateField,
  type ExternalRecord,
  type FieldValue,
  type RecordKind,
} from './sdk';

/** Phase 11: gemeinsame Helfer der REST-Connectoren (Google, Microsoft, Dropbox, Telegram). */

export const endpoint = (ctx: ConnectorContext, key: string, fallback: string) =>
  (ctx.endpoints?.[key] ?? fallback).replace(/\/$/, '');

export interface JsonCall {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Statuscodes, die der Aufrufer selbst behandelt (z. B. 410 bei abgelaufenem Sync-Token) */
  accept?: number[];
  /** Ohne OAuth-Token (z. B. Telegram, Token steckt in der URL) */
  noAuth?: boolean;
}

export async function apiJson<T>(
  ctx: ConnectorContext,
  service: string,
  url: string,
  call: JsonCall = {},
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(call.headers ?? {}) };
  if (!call.noAuth) {
    if (!ctx.accessToken) throw new ConnectorError('auth', `${service}: nicht angemeldet`);
    headers.Authorization = `Bearer ${await ctx.accessToken()}`;
  }
  let body: string | undefined;
  if (call.body !== undefined) {
    body = JSON.stringify(call.body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await guard(() =>
    ctx.http.fetch(url, { method: call.method ?? 'GET', headers, body }),
  );
  let data: unknown = null;
  const text = res.body.toString('utf8');
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (call.accept?.includes(res.status)) return { status: res.status, data: data as T };
  if (res.status === 401)
    throw new ConnectorError('auth', `${service}: Anmeldung abgelaufen, bitte neu verbinden`);
  if (res.status === 403)
    throw new ConnectorError(
      'auth',
      `${service}: Zugriff verweigert (fehlende Berechtigung oder Dienst nicht freigeschaltet)`,
    );
  if (res.status === 404) throw new ConnectorError('not_found', `${service}: nicht gefunden`);
  if (res.status === 429 || res.status >= 500) {
    const retry = res.headers['retry-after'];
    throw new ConnectorError(
      'network',
      `${service}: vorübergehend nicht verfügbar (Status ${res.status}${retry ? `, erneut nach ${String(retry)} s` : ''})`,
    );
  }
  if (res.status < 200 || res.status >= 300)
    throw new ConnectorError('protocol', `${service}: unerwartete Antwort (Status ${res.status})`);
  if (res.truncated) throw new ConnectorError('protocol', `${service}: Antwort zu groß`);
  return { status: res.status, data: data as T };
}

/** Datensatz mit Version aus den normalisierten Feldern */
export function record(
  kind: RecordKind,
  externalId: string,
  fields: Record<string, FieldValue>,
  remoteRef: string | null = externalId,
): ExternalRecord {
  return {
    externalId,
    weakId: false,
    remoteRef,
    kind,
    fields,
    version: recordVersion(kind, fields),
  };
}

/** Zeitpunkt als Datumsfeld (UTC) */
export function instant(iso: string | null | undefined): DateField | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { start: d.toISOString(), end: null, hasTime: true };
}

/** Höchstzahl Seiten einer Abfrage (Schutz vor Endlosschleifen bei fehlerhaften Antworten) */
export const MAX_PAGES = 200;

export function windowBounds(ctx: ConnectorContext, pastDays: number, futureDays: number) {
  const now = ctx.now();
  return {
    from: new Date(now - pastDays * 86_400_000).toISOString(),
    to: new Date(now + futureDays * 86_400_000).toISOString(),
  };
}

export const today = (ctx: ConnectorContext) => new Date(ctx.now()).toISOString().slice(0, 10);

/** Text kürzen (Betreff aus Nachrichten, Titel) */
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
