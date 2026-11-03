import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Hocuspocus, type Document } from '@hocuspocus/server';
import { appendSubpageBlock, removeSubpageBlocks } from '@jotion/editor/projection';
import { pageDocName, pageIdFromDocName } from '@jotion/editor';
import type { ServerEnv } from '@jotion/shared/env';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { SESSION_COOKIE, SessionService } from '../auth/session.service';
import { SERVER_ENV } from '../config/config.module';
import { PermissionService } from '../permissions/permission.service';
import { DocStore } from './doc-store';
import { extractDocumentUpdate } from './sync-message';

export const COLLAB_PATH = '/collab';
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

interface CollabContext {
  userId?: string;
  pageId?: string;
  system?: boolean;
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/**
 * Echtzeit-Bearbeitung (Yjs über Hocuspocus) im API-Prozess.
 * Garantie gegen Datenverlust: Jedes Update wird in beforeHandleMessage gespeichert,
 * bevor Hocuspocus es anwendet und dem Client als gespeichert bestätigt.
 */
@Injectable()
export class CollabService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Collab');
  readonly hocuspocus: Hocuspocus;
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  private readonly allowedOrigins: Set<string>;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly sessions: SessionService,
    private readonly perms: PermissionService,
    private readonly store: DocStore,
    @Inject(SERVER_ENV) env: ServerEnv,
  ) {
    this.allowedOrigins = new Set(
      [env.JOTION_PUBLIC_URL, ...env.JOTION_ALLOWED_ORIGINS].map((o) => new URL(o).origin),
    );
    this.hocuspocus = new Hocuspocus({
      name: 'jotion',
      quiet: true,
      debounce: 2000,
      maxDebounce: 10_000,
      timeout: 30_000,
      onConnect: async ({ documentName, requestHeaders, connectionConfig }) => {
        const pageId = pageIdFromDocName(documentName);
        const token = readCookie(requestHeaders.cookie, SESSION_COOKIE);
        const user = token ? await this.sessions.validate(token) : null;
        if (!pageId || !user) throw new Error('unauthorized');
        const { page } = await this.perms.requirePage(user.id, pageId, { includeTrashed: true });
        const locked = Boolean((page.settings as { locked?: boolean } | null)?.locked);
        connectionConfig.readOnly = Boolean(page.deletedAt) || locked;
        return { userId: user.id, pageId } satisfies CollabContext;
      },
      // Token wird nicht benötigt (Cookie-Session), Hook muss aber existieren
      onAuthenticate: async () => ({}),
      beforeHandleMessage: async ({ update, connection, context }) => {
        const ctx = context as CollabContext;
        if (!ctx.pageId || connection.readOnly) return;
        const docUpdate = extractDocumentUpdate(update);
        if (docUpdate) await this.store.append(ctx.pageId, docUpdate, ctx.userId ?? null);
      },
      onLoadDocument: async ({ documentName, document }) => {
        const pageId = pageIdFromDocName(documentName);
        if (!pageId) throw new Error('unknown document');
        const res = await this.store.loadInto(pageId, document);
        if (res.skipped)
          this.logger.warn(`${res.skipped} unlesbare Einträge in ${documentName} übersprungen`);
        return document;
      },
      onStoreDocument: async ({ documentName, document, context }) => {
        const pageId = pageIdFromDocName(documentName);
        if (!pageId) return;
        const ctx = context as CollabContext;
        await this.store.compact(pageId, document, ctx.system ? null : (ctx.userId ?? null));
      },
    });
  }

  onApplicationBootstrap(): void {
    const server = this.adapterHost.httpAdapter.getHttpServer();
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) =>
      this.handleUpgrade(req, socket, head),
    );
  }

  async onModuleDestroy(): Promise<void> {
    // Updates sind bereits gespeichert (beforeHandleMessage); Clients verbinden sich neu
    for (const client of this.wss.clients) client.terminate();
    this.wss.close();
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== COLLAB_PATH) {
      socket.destroy();
      return;
    }
    // Schutz gegen Cross-Site-WebSocket-Hijacking: Browser senden immer Origin
    const origin = req.headers.origin;
    if (origin && !this.allowedOrigins.has(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.hocuspocus.handleConnection(ws, req));
  }

  /**
   * Verbindungen neu prüfen lassen (Rechte, Papierkorb, Sperre).
   * Schließt bewusst den WebSocket selbst: Hocuspocus' closeConnections() beendet nur das
   * Dokument, der Client verbindet sich danach nicht neu und würde unbemerkt nicht mehr speichern.
   * Nach dem Schließen verbindet sich der Provider automatisch neu und durchläuft onConnect.
   */
  revalidate(pageId?: string): void {
    const name = pageId ? pageDocName(pageId) : undefined;
    this.hocuspocus.documents.forEach((doc) => {
      if (name && doc.name !== name) return;
      for (const conn of doc.getConnections()) conn.webSocket.close(1012, 'revalidate');
    });
  }

  /** Serverseitige Änderung am Dokument einer Seite (z. B. Unterseiten-Block). Fehler werden nur protokolliert. */
  private async withDocument(pageId: string, fn: (doc: Document) => void): Promise<void> {
    try {
      const conn = await this.hocuspocus.openDirectConnection(pageDocName(pageId), {
        system: true,
      } satisfies CollabContext);
      try {
        await conn.transact(fn);
      } finally {
        await conn.disconnect();
      }
    } catch (err) {
      this.logger.error(
        `Dokument ${pageId} konnte nicht aktualisiert werden: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  addSubpageBlock(parentId: string, childId: string): Promise<void> {
    return this.withDocument(
      parentId,
      (doc) => void appendSubpageBlock(doc, childId, randomUUID()),
    );
  }

  removeSubpageBlock(parentId: string, childId: string): Promise<void> {
    return this.withDocument(parentId, (doc) => void removeSubpageBlocks(doc, childId));
  }
}
