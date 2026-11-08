import { lookup as dnsLookup } from 'node:dns/promises';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/**
 * Serverseitige HTTP-Abrufe mit SSRF-Schutz (Phase 3, Bookmark-Vorschau; später Webhooks, Connectoren).
 *  - nur http/https auf Standard-Ports
 *  - DNS wird vorher aufgelöst, private, lokale und reservierte Adressen werden abgelehnt
 *  - die Verbindung geht genau an die geprüfte Adresse (kein DNS-Rebinding zwischen Prüfung und Abruf)
 *  - Weiterleitungen werden einzeln geprüft, Zeit- und Größenlimits
 * Ausnahmen nur über die Admin-Allowlist (Hostnamen oder CIDR-Bereiche).
 */
export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(net, prefix, 'ipv6');

/** Netzwerkfehler (Zeitüberschreitung, Verbindung abgebrochen), keine Richtlinienverletzung. */
export class NetworkError extends SsrfError {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** IPv4 aus IPv4-gemappten oder -kompatiblen IPv6-Adressen (::ffff:10.0.0.1) */
function embeddedIpv4(ip: string): string | null {
  const m = /^(?:0*:)*:?(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (m) return m[1]!;
  const hex = /^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (hex) {
    const a = Number.parseInt(hex[1]!, 16);
    const b = Number.parseInt(hex[2]!, 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return null;
}

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return blocked.check(ip, 'ipv4');
  if (family === 6) {
    const v4 = embeddedIpv4(ip);
    if (v4) return blocked.check(v4, 'ipv4');
    return blocked.check(ip, 'ipv6');
  }
  return true;
}

export interface SafeRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
}

export interface SafeHttpOptions {
  /** User-Agent der Anfragen */
  userAgent?: string;
  /** Hostnamen oder CIDR-Bereiche, die trotz privater Adresse erlaubt sind */
  allowlist?: string[];
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  accept?: string;
}

export interface SafeHttpResponse {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
  truncated: boolean;
  headers: Record<string, string | string[] | undefined>;
}

class Allowlist {
  private readonly hosts = new Set<string>();
  private readonly nets = new BlockList();
  private hasNets = false;

  constructor(entries: string[]) {
    for (const raw of entries) {
      const e = raw.trim().toLowerCase();
      if (!e) continue;
      const [addr, prefix] = e.split('/');
      const fam = isIP(addr ?? '');
      if (fam) {
        const bits = prefix ? Number(prefix) : fam === 4 ? 32 : 128;
        this.nets.addSubnet(addr!, bits, fam === 4 ? 'ipv4' : 'ipv6');
        this.hasNets = true;
      } else this.hosts.add(e);
    }
  }

  host(h: string): boolean {
    return this.hosts.has(h.toLowerCase());
  }

  ip(ip: string): boolean {
    if (!this.hasNets) return false;
    const fam = isIP(ip);
    return fam ? this.nets.check(ip, fam === 4 ? 'ipv4' : 'ipv6') : false;
  }
}

export class SafeHttpClient {
  private readonly allow: Allowlist;

  constructor(private readonly opts: SafeHttpOptions = {}) {
    this.allow = new Allowlist(opts.allowlist ?? []);
  }

  /** Prüft URL und DNS. Liefert die zu verwendende Adresse. */
  async resolve(raw: string): Promise<{ url: URL; address: string; family: 4 | 6 }> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new SsrfError('Ungültige URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new SsrfError('Nur http und https sind erlaubt');
    if (url.username || url.password)
      throw new SsrfError('Zugangsdaten in URLs sind nicht erlaubt');
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const hostAllowed = this.allow.host(hostname);
    const defaultPort = url.port === '' || url.port === '80' || url.port === '443';

    let addresses: { address: string; family: number }[];
    if (isIP(hostname)) addresses = [{ address: hostname, family: isIP(hostname) }];
    else {
      try {
        addresses = await dnsLookup(hostname, { all: true, verbatim: true });
      } catch {
        throw new SsrfError('Host nicht gefunden');
      }
    }
    if (!addresses.length) throw new SsrfError('Host nicht gefunden');
    // Alle Adressen müssen erlaubt sein, sonst könnte die Verbindung eine private treffen
    for (const a of addresses) {
      if (isBlockedAddress(a.address) && !hostAllowed && !this.allow.ip(a.address))
        throw new SsrfError('Adresse nicht erlaubt');
    }
    // Andere Ports nur für freigegebene Ziele (z. B. internes Wiki auf Port 8080)
    if (!defaultPort && !hostAllowed && !addresses.every((a) => this.allow.ip(a.address)))
      throw new SsrfError('Nur Standard-Ports sind erlaubt');
    const first = addresses[0]!;
    return { url, address: first.address, family: first.family === 6 ? 6 : 4 };
  }

  async get(raw: string, headers: Record<string, string> = {}): Promise<SafeHttpResponse> {
    return this.fetch(raw, { method: 'GET', headers });
  }

  /**
   * Beliebige Methode (z. B. PROPFIND, REPORT für CalDAV). Weiterleitungen folgen nur GET und
   * HEAD; Zugangsdaten (Authorization) gehen bei einer Weiterleitung nur an denselben Host.
   */
  async fetch(raw: string, req: SafeRequest = {}): Promise<SafeHttpResponse> {
    const maxRedirects = this.opts.maxRedirects ?? 3;
    const deadline = Date.now() + (this.opts.timeoutMs ?? 5000);
    const method = (req.method ?? 'GET').toUpperCase();
    const origin = new URL(raw).host;
    let current = raw;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const target = await this.resolve(current);
      const headers = { ...(req.headers ?? {}) };
      if (target.url.host !== origin) delete headers.Authorization;
      const res = await this.request(target, deadline, { ...req, method, headers });
      if (res.redirect && (method === 'GET' || method === 'HEAD')) {
        current = new URL(res.redirect, target.url).toString();
        continue;
      }
      if (res.redirect)
        return {
          url: target.url.toString(),
          status: 301,
          contentType: '',
          body: Buffer.alloc(0),
          truncated: false,
          headers: { location: res.redirect },
        };
      return res.response!;
    }
    throw new SsrfError('Zu viele Weiterleitungen');
  }

  private request(
    target: { url: URL; address: string; family: 4 | 6 },
    deadline: number,
    req: SafeRequest & { method: string },
  ): Promise<{ redirect?: string; response?: SafeHttpResponse }> {
    const maxBytes = this.opts.maxBytes ?? 1024 * 1024;
    const lib = target.url.protocol === 'https:' ? https : http;
    // Verbindung nur zur geprüften Adresse
    const lookup: LookupFunction = (_host, options, cb) => {
      if ((options as { all?: boolean }).all)
        (cb as (e: null, a: { address: string; family: number }[]) => void)(null, [
          { address: target.address, family: target.family },
        ]);
      else cb(null, target.address, target.family);
    };
    return new Promise((resolve, reject) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return reject(new NetworkError('Zeitüberschreitung'));
      const request = lib.request(
        target.url,
        {
          method: req.method,
          lookup,
          agent: false,
          headers: {
            'User-Agent': this.opts.userAgent ?? 'JotionBot/1.0 (Link-Vorschau)',
            Accept: this.opts.accept ?? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
            'Accept-Encoding': 'identity',
            ...(req.body !== undefined ? { 'Content-Length': String(Buffer.byteLength(req.body)) } : {}),
            ...(req.headers ?? {}),
          },
        },
        (res: IncomingMessage) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            clearTimeout(timer);
            return resolve({ redirect: res.headers.location });
          }
          const chunks: Buffer[] = [];
          let size = 0;
          let truncated = false;
          res.on('data', (chunk: Buffer) => {
            if (truncated) return;
            size += chunk.length;
            if (size > maxBytes) {
              chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
              truncated = true;
              res.destroy();
              finish();
            } else chunks.push(chunk);
          });
          const finish = () => {
            clearTimeout(timer);
            resolve({
              response: {
                url: target.url.toString(),
                status,
                contentType: String(res.headers['content-type'] ?? ''),
                body: Buffer.concat(chunks),
                truncated,
                headers: res.headers,
              },
            });
          };
          res.on('end', finish);
          res.on('error', (err) => (truncated ? undefined : reject(err)));
        },
      );
      const timer = setTimeout(() => {
        request.destroy(new NetworkError('Zeitüberschreitung'));
      }, remaining);
      request.on('error', (err) => {
        clearTimeout(timer);
        reject(
          err instanceof SsrfError ? err : new NetworkError(`Abruf fehlgeschlagen: ${err.message}`),
        );
      });
      if (req.body !== undefined) request.write(req.body);
      request.end();
    });
  }
}
