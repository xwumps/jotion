import type { LinkPreviewDto } from '@jotion/shared';

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1]!.toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
  return out;
}

const clean = (s: string | undefined, max: number): string | null => {
  const v = s?.replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, max) : null;
};

function absolute(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href.trim(), base);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    const s = u.toString();
    return s.length <= 2048 ? s : null;
  } catch {
    return null;
  }
}

/** Zeichensatz aus Content-Type oder <meta charset>. */
export function detectCharset(contentType: string, head: Buffer): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const ascii = head.subarray(0, 4096).toString('latin1');
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(ascii)?.[1];
  return (fromMeta ?? 'utf-8').toLowerCase();
}

export function decodeBody(body: Buffer, contentType: string): string {
  const charset = detectCharset(contentType, body);
  try {
    return new TextDecoder(charset, { fatal: false }).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

/** Liest OpenGraph-, Twitter- und Standard-Metadaten aus HTML (nur der Kopf ist nötig). */
export function parseOpenGraph(html: string, pageUrl: string): LinkPreviewDto {
  const headEnd = html.search(/<\/head>|<body[\s>]/i);
  const head = headEnd > 0 ? html.slice(0, headEnd) : html.slice(0, 300_000);
  const meta: Record<string, string> = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property ?? a.name ?? '').toLowerCase();
    if (key && a.content !== undefined && meta[key] === undefined) meta[key] = a.content;
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  let favicon: string | null = null;
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const rel = (a.rel ?? '').toLowerCase().split(/\s+/);
    if (rel.includes('icon') || rel.includes('apple-touch-icon')) {
      favicon = absolute(a.href, pageUrl);
      if (favicon && rel.includes('icon')) break;
    }
  }
  const host = new URL(pageUrl).hostname.replace(/^www\./, '');
  return {
    url: pageUrl,
    title: clean(
      meta['og:title'] ?? meta['twitter:title'] ?? (titleTag ? decodeEntities(titleTag) : undefined),
      300,
    ),
    description: clean(
      meta['og:description'] ?? meta['twitter:description'] ?? meta.description,
      500,
    ),
    image: absolute(meta['og:image'] ?? meta['og:image:url'] ?? meta['twitter:image'], pageUrl),
    siteName: clean(meta['og:site_name'], 100) ?? host,
    favicon: favicon ?? absolute('/favicon.ico', pageUrl),
  };
}
