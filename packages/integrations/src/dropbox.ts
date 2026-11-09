import { apiJson, endpoint, instant, MAX_PAGES, record } from './rest';
import {
  ConnectorError,
  type ConnectorContext,
  type ConnectorDefinition,
  type ExternalRecord,
  type PullResult,
} from './sdk';

/**
 * Phase 11: Dropbox (API v2, OAuth mit PKCE). Eine Quelle je Verbindung: der konfigurierte Ordner
 * samt Unterordnern; inkrementell über list_folder/continue.
 */

const SERVICE = 'Dropbox';
const base = (ctx: ConnectorContext) => endpoint(ctx, 'dropbox', 'https://api.dropboxapi.com/2');

interface DbxEntry {
  '.tag': 'file' | 'folder' | 'deleted';
  id?: string;
  name: string;
  path_lower?: string;
  path_display?: string;
  size?: number;
  server_modified?: string;
}

interface ListResult {
  entries: DbxEntry[];
  cursor: string;
  has_more: boolean;
}

const folderOf = (config: Record<string, unknown>) => {
  const f = typeof config.folder === 'string' ? config.folder.trim() : '';
  if (!f || f === '/') return '';
  return `/${f.replace(/^\/+|\/+$/g, '')}`;
};

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  txt: 'text/plain',
  md: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
};

export function dropboxRecord(e: DbxEntry): ExternalRecord | null {
  if (e['.tag'] !== 'file' || !e.id) return null;
  const ext = e.name.includes('.') ? e.name.split('.').pop()!.toLowerCase() : '';
  // Pfad als Referenz: Löschungen liefert Dropbox nur mit Pfad
  return record(
    'file',
    e.id,
    {
      title: e.name,
      path: e.path_display ?? null,
      size: typeof e.size === 'number' ? e.size : null,
      mime: MIME[ext] ?? null,
      date: instant(e.server_modified),
      url: e.path_display
        ? `https://www.dropbox.com/preview${e.path_display.split('/').map(encodeURIComponent).join('/')}`
        : null,
    },
    e.path_lower ?? null,
  );
}

type DbxCursor = { cursor?: string };

async function pull(ctx: ConnectorContext, c: DbxCursor | null): Promise<PullResult> {
  const records: ExternalRecord[] = [];
  const deletedRefs: string[] = [];
  let incremental = !!c?.cursor;
  let res: ListResult | null = null;
  if (c?.cursor) {
    const r = await apiJson<ListResult | { error_summary?: string }>(
      ctx,
      SERVICE,
      `${base(ctx)}/files/list_folder/continue`,
      { method: 'POST', body: { cursor: c.cursor }, accept: [409] },
    );
    // Cursor ungültig (reset): vollständig neu
    if (r.status === 409) incremental = false;
    else res = r.data as ListResult;
  }
  if (!res) {
    res = (
      await apiJson<ListResult>(ctx, SERVICE, `${base(ctx)}/files/list_folder`, {
        method: 'POST',
        body: { path: folderOf(ctx.config), recursive: true, include_deleted: false, limit: 2000 },
        accept: [],
      })
    ).data;
  }
  for (let page = 0; page < MAX_PAGES; page++) {
    for (const e of res.entries) {
      if (e['.tag'] === 'deleted') {
        if (e.path_lower) deletedRefs.push(e.path_lower);
        continue;
      }
      const rec = dropboxRecord(e);
      if (rec) records.push(rec);
    }
    if (!res.has_more) break;
    res = (
      await apiJson<ListResult>(ctx, SERVICE, `${base(ctx)}/files/list_folder/continue`, {
        method: 'POST',
        body: { cursor: res.cursor },
      })
    ).data;
  }
  return {
    records,
    deletedRefs,
    refreshedRefs: [],
    complete: !incremental,
    cursor: { cursor: res.cursor },
  };
}

export const dropboxConnector: ConnectorDefinition = {
  type: 'dropbox',
  displayName: 'Dropbox',
  authKind: 'oauth2',
  oauth: { provider: 'dropbox', scopes: ['account_info.read', 'files.metadata.read'] },
  configFields: ['folder'],
  secretFields: [],
  capabilities: { kinds: ['file'], incremental: true, write: false },
  validateConfig(config) {
    const folder = folderOf(config);
    if (/\.\./.test(folder)) throw new ConnectorError('config', 'Ordner: ungültiger Pfad');
    return { folder, account: typeof config.account === 'string' ? config.account : null };
  },
  async testConnection(ctx) {
    const { data } = await apiJson<{ email?: string; name?: { display_name?: string } }>(
      ctx,
      SERVICE,
      `${base(ctx)}/users/get_current_account`,
      { method: 'POST' },
    );
    return {
      accountLabel: data.email ?? data.name?.display_name ?? 'Dropbox',
      sources: await this.discoverSources(ctx),
      capabilities: { files: true, incremental: true },
    };
  },
  async discoverSources(ctx) {
    const folder = folderOf(ctx.config);
    return [
      { remoteId: 'dropbox', name: folder ? `Dropbox: ${folder}` : 'Dropbox', kinds: ['file'] },
    ];
  },
  pull(ctx, _source, cursor) {
    return pull(ctx, cursor as DbxCursor | null);
  },
};
