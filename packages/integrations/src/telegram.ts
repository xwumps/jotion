import { guard } from './guard';
import { clip, endpoint, instant, MAX_PAGES, record } from './rest';
import {
  ConnectorError,
  type ConnectorContext,
  type ConnectorDefinition,
  type ExternalRecord,
  type PullResult,
} from './sdk';

/**
 * Phase 11: Telegram-Bot (Bot API, Long Polling über getUpdates, kein öffentlicher Webhook nötig).
 * Nachrichten erlaubter Absender werden zu Zeilen (z. B. eine Inbox-Datenbank). Nachrichten
 * anderer Absender werden verworfen, damit niemand über den Bot Zeilen anlegen kann.
 */


interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}
interface TgMessage {
  message_id: number;
  date: number;
  edit_date?: number;
  text?: string;
  caption?: string;
  from?: TgUser;
  chat: { id: number; type: string; title?: string; username?: string };
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgMessage;
}

/** Bot-Token: Ziffern, Doppelpunkt, mindestens 30 Zeichen */
const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,}$/;

async function call<T>(
  ctx: ConnectorContext,
  method: string,
  params: Record<string, unknown> = {},
) {
  const token = ctx.secrets.botToken ?? '';
  if (!TOKEN_RE.test(token))
    throw new ConnectorError('auth', 'Telegram: Bot-Token fehlt oder ist ungültig');
  const url = `${endpoint(ctx, 'telegram', 'https://api.telegram.org')}/bot${token}/${method}`;
  const res = await guard(() =>
    ctx.http.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(params),
    }),
  );
  let json: { ok?: boolean; result?: T; description?: string } = {};
  try {
    json = JSON.parse(res.body.toString('utf8')) as typeof json;
  } catch {
    /* unten */
  }
  if (res.status === 401 || res.status === 404)
    throw new ConnectorError('auth', 'Telegram: Bot-Token ungültig oder widerrufen');
  if (res.status === 409)
    throw new ConnectorError(
      'config',
      'Telegram: Für den Bot ist ein Webhook eingerichtet oder ein anderer Abruf läuft (deleteWebhook nötig)',
    );
  if (res.status === 429 || res.status >= 500)
    throw new ConnectorError(
      'network',
      `Telegram: vorübergehend nicht verfügbar (Status ${res.status})`,
    );
  if (!json.ok) throw new ConnectorError('protocol', `Telegram: ${json.description ?? 'Fehler'}`);
  return json.result as T;
}

function allowedSenders(config: Record<string, unknown>): string[] {
  const raw = Array.isArray(config.allowedUsers)
    ? config.allowedUsers.join(',')
    : typeof config.allowedUsers === 'string'
      ? config.allowedUsers
      : '';
  return [
    ...new Set(
      raw
        .split(/[,\s;]+/)
        .map((s) => s.trim().replace(/^@/, '').toLowerCase())
        .filter((s) => /^[a-z0-9_]{3,32}$|^\d{3,15}$/.test(s)),
    ),
  ];
}

const isAllowed = (allowed: string[], u?: TgUser) =>
  !!u &&
  (allowed.includes(String(u.id)) || (!!u.username && allowed.includes(u.username.toLowerCase())));

const displayName = (u?: TgUser) =>
  u
    ? [u.first_name, u.last_name].filter(Boolean).join(' ') +
      (u.username ? ` (@${u.username})` : '')
    : null;

export function telegramRecord(m: TgMessage): ExternalRecord | null {
  const text = (m.text ?? m.caption ?? '').trim();
  if (!text) return null;
  const first = text.split('\n')[0]!.trim();
  return record('message', `${m.chat.id}:${m.message_id}`, {
    title: clip(first, 120),
    description: text,
    date: instant(new Date(m.date * 1000).toISOString()),
    from: displayName(m.from)?.trim() || null,
    to: m.chat.title ?? null,
    categories: [m.chat.type === 'private' ? 'Privat' : (m.chat.title ?? m.chat.type)],
    read: null,
    url: m.chat.username ? `https://t.me/${m.chat.username}/${m.message_id}` : null,
  });
}

type TgCursor = { offset?: number };

async function pull(ctx: ConnectorContext, cursor: TgCursor | null): Promise<PullResult> {
  const allowed = allowedSenders(ctx.config);
  const records = new Map<string, ExternalRecord>();
  let offset = cursor?.offset ?? 0;
  let ignored = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const updates = await call<TgUpdate[]>(ctx, 'getUpdates', {
      offset,
      timeout: 0,
      limit: 100,
      allowed_updates: ['message', 'edited_message', 'channel_post'],
    });
    if (!updates.length) break;
    for (const u of updates) {
      offset = Math.max(offset, u.update_id + 1);
      const m = u.message ?? u.edited_message ?? u.channel_post;
      if (!m) continue;
      // Kanäle haben keinen Absender: nur, wenn der Kanal selbst erlaubt ist
      const ok = m.from
        ? isAllowed(allowed, m.from)
        : !!m.chat.username && allowed.includes(m.chat.username.toLowerCase());
      if (!ok) {
        ignored++;
        continue;
      }
      const rec = telegramRecord(m);
      if (rec) records.set(rec.externalId, rec);
    }
    if (updates.length < 100) break;
  }
  return {
    records: [...records.values()],
    deletedRefs: [],
    refreshedRefs: [],
    errors: ignored
      ? [
          {
            ref: 'telegram',
            message: `${ignored} Nachricht(en) von nicht erlaubten Absendern verworfen`,
          },
        ]
      : undefined,
    complete: false,
    // Erst nach erfolgreicher Verarbeitung gespeichert: Telegram liefert bis dahin erneut
    cursor: { offset },
  };
}

export const telegramConnector: ConnectorDefinition = {
  type: 'telegram',
  displayName: 'Telegram-Bot',
  authKind: 'token',
  configFields: ['allowedUsers'],
  secretFields: ['botToken'],
  capabilities: { kinds: ['message'], incremental: true, write: false },
  validateConfig(config) {
    const allowedUsers = allowedSenders(config);
    if (!allowedUsers.length)
      throw new ConnectorError(
        'config',
        'Erlaubte Absender: mindestens einen Telegram-Benutzernamen oder eine Nutzer-ID angeben',
      );
    return { allowedUsers };
  },
  async testConnection(ctx) {
    const me = await call<{ username?: string; first_name?: string }>(ctx, 'getMe');
    return {
      accountLabel: me.username ? `@${me.username}` : (me.first_name ?? 'Bot'),
      sources: await this.discoverSources(ctx),
      capabilities: { messages: true, incremental: true },
    };
  },
  async discoverSources(ctx) {
    const me = await call<{ username?: string }>(ctx, 'getMe');
    return [
      {
        remoteId: 'messages',
        name: me.username ? `Nachrichten an @${me.username}` : 'Nachrichten an den Bot',
        kinds: ['message'],
      },
    ];
  },
  pull(ctx, _source, cursor) {
    return pull(ctx, cursor as TgCursor | null);
  },
};

/** Phase 11: Nachricht über den Bot senden (Benachrichtigungen aus Automatisierungen). */
export function telegramSend(ctx: ConnectorContext, chatId: string, text: string) {
  return call<unknown>(ctx, 'sendMessage', {
    chat_id: chatId,
    text: clip(text, 4000),
    disable_web_page_preview: true,
  });
}
