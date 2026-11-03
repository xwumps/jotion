/**
 * Whitelist für Einbettungen. Nur bekannte Anbieter, die iframe-Adresse wird immer aus der
 * eingegebenen URL neu abgeleitet (nie aus gespeicherten Attributen übernommen).
 */
export const EMBED_PROVIDERS = [
  'youtube',
  'vimeo',
  'figma',
  'googleMaps',
  'loom',
  'codepen',
  'spotify',
] as const;
export type EmbedProvider = (typeof EMBED_PROVIDERS)[number];

export interface ResolvedEmbed {
  provider: EmbedProvider;
  /** Adresse für das iframe */
  src: string;
  /** Empfohlene Höhe in Pixeln */
  height: number;
}

/** sandbox-Rechte für Einbettungen (alle Ziele sind fremde Origins). */
export const EMBED_SANDBOX =
  'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function parse(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

const host = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, '');

function youtube(u: URL): string | null {
  const h = host(u);
  let id: string | null = null;
  if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0] ?? null;
  else if (h === 'youtube.com' || h === 'm.youtube.com' || h === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = /^\/(?:embed|shorts|live)\/([^/]+)/.exec(u.pathname);
      id = m?.[1] ?? null;
    }
  }
  if (!id || !ID_RE.test(id)) return null;
  const start = Number.parseInt(u.searchParams.get('t') ?? u.searchParams.get('start') ?? '', 10);
  return `https://www.youtube-nocookie.com/embed/${id}${Number.isFinite(start) && start > 0 ? `?start=${start}` : ''}`;
}

function vimeo(u: URL): string | null {
  const h = host(u);
  if (h !== 'vimeo.com' && h !== 'player.vimeo.com') return null;
  const m = /^\/(?:video\/)?(\d{1,15})(?:\/([0-9a-f]{1,20}))?/.exec(u.pathname);
  if (!m) return null;
  const hash = m[2] ? `?h=${m[2]}` : '';
  return `https://player.vimeo.com/video/${m[1]}${hash}`;
}

function figma(u: URL): string | null {
  if (host(u) !== 'figma.com') return null;
  if (!/^\/(file|design|proto|board|slides)\/[A-Za-z0-9]+/.test(u.pathname)) return null;
  return `https://www.figma.com/embed?embed_host=jotion&url=${encodeURIComponent(u.toString())}`;
}

function googleMaps(u: URL): string | null {
  const h = host(u);
  const isGoogle = h === 'google.com' || h === 'maps.google.com' || /^google\.[a-z.]{2,6}$/.test(h);
  if (!isGoogle) return null;
  if (u.pathname.startsWith('/maps/embed')) {
    const pb = u.searchParams.get('pb');
    if (pb && /^[A-Za-z0-9!._:%-]+$/.test(pb) && pb.length < 2000)
      return `https://www.google.com/maps/embed?pb=${pb}`;
    return null;
  }
  if (!u.pathname.startsWith('/maps')) return null;
  let q = u.searchParams.get('q');
  if (!q) {
    const place = /^\/maps\/place\/([^/]+)/.exec(u.pathname);
    if (place?.[1]) q = decodeURIComponent(place[1]).replace(/\+/g, ' ');
  }
  if (!q) {
    const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(u.pathname);
    if (at) q = `${at[1]},${at[2]}`;
  }
  if (!q || q.length > 300) return null;
  return `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
}

function loom(u: URL): string | null {
  if (host(u) !== 'loom.com') return null;
  const m = /^\/(?:share|embed)\/([0-9a-f]{10,64})/.exec(u.pathname);
  return m ? `https://www.loom.com/embed/${m[1]}` : null;
}

function codepen(u: URL): string | null {
  if (host(u) !== 'codepen.io') return null;
  const m = /^\/([A-Za-z0-9_-]{1,64})\/(?:pen|embed)\/([A-Za-z0-9]{1,32})/.exec(u.pathname);
  return m ? `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result` : null;
}

function spotify(u: URL): string | null {
  if (host(u) !== 'open.spotify.com') return null;
  const m =
    /^\/(?:intl-[a-z]{2}\/)?(?:embed\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]{1,40})/.exec(
      u.pathname,
    );
  return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}` : null;
}

const RESOLVERS: { provider: EmbedProvider; fn: (u: URL) => string | null; height: number }[] = [
  { provider: 'youtube', fn: youtube, height: 400 },
  { provider: 'vimeo', fn: vimeo, height: 400 },
  { provider: 'figma', fn: figma, height: 450 },
  { provider: 'googleMaps', fn: googleMaps, height: 400 },
  { provider: 'loom', fn: loom, height: 400 },
  { provider: 'codepen', fn: codepen, height: 400 },
  { provider: 'spotify', fn: spotify, height: 352 },
];

/** Liefert die iframe-Adresse für eine erlaubte URL, sonst null. */
export function resolveEmbed(raw: unknown): ResolvedEmbed | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  const u = parse(raw);
  if (!u) return null;
  for (const r of RESOLVERS) {
    const src = r.fn(u);
    if (src) return { provider: r.provider, src, height: r.height };
  }
  return null;
}
