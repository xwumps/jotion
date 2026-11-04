import { mergeAttributes, Node, type Attributes } from '@tiptap/core';
import { resolveEmbed } from '../embeds';
import { safeExternalUrl, safeMediaSrc } from '../urls';

export const MEDIA_NODE_TYPES = ['image', 'video', 'audio', 'file', 'pdf'] as const;
export type MediaNodeType = (typeof MEDIA_NODE_TYPES)[number];

export interface MediaAttrs {
  src?: string | null;
  name?: string | null;
  size?: number | null;
  mime?: string | null;
  /** Breite in Prozent der Inhaltsbreite (10 bis 100) */
  width?: number | null;
  align?: 'left' | 'center' | 'right';
  caption?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    media: {
      /** Fügt einen Medienblock ein (Bild, Video, Audio, Datei, PDF). Ohne src als leerer Platzhalter. */
      insertMedia: (type: MediaNodeType, attrs?: MediaAttrs) => ReturnType;
    };
    bookmark: {
      insertBookmark: (attrs?: { url?: string | null }) => ReturnType;
    };
    embed: {
      insertEmbed: (attrs?: { url?: string | null }) => ReturnType;
    };
  }
}

const clampWidth = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''));
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(10, Math.round(n)));
};

const dataAttr = (name: string, key: string, fallback: unknown = null): Attributes[string] => ({
  default: fallback,
  parseHTML: (el) => el.getAttribute(`data-${name}`) ?? fallback,
  renderHTML: (attrs) =>
    attrs[key] !== null && attrs[key] !== undefined && attrs[key] !== ''
      ? { [`data-${name}`]: String(attrs[key]) }
      : {},
});

function commonAttrs(): Attributes {
  return {
    src: {
      default: null,
      parseHTML: (el) =>
        safeMediaSrc(el.getAttribute('data-src') ?? el.getAttribute('src')) ?? null,
      renderHTML: (attrs) => (attrs.src ? { 'data-src': attrs.src } : {}),
    },
    name: dataAttr('name', 'name'),
    size: {
      default: null,
      parseHTML: (el) => {
        const n = Number.parseInt(el.getAttribute('data-size') ?? '', 10);
        return Number.isFinite(n) ? n : null;
      },
      renderHTML: (attrs) => (attrs.size ? { 'data-size': String(attrs.size) } : {}),
    },
    mime: dataAttr('mime', 'mime'),
    width: {
      default: null,
      parseHTML: (el) => clampWidth(el.getAttribute('data-width')),
      renderHTML: (attrs) => (attrs.width ? { 'data-width': String(attrs.width) } : {}),
    },
    align: dataAttr('align', 'align', 'center'),
    caption: dataAttr('caption', 'caption', ''),
  };
}

function mediaNode(name: MediaNodeType) {
  return Node.create({
    name,
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes: commonAttrs,
    parseHTML() {
      return [{ tag: `div[data-type="${name}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes(HTMLAttributes, { 'data-type': name })];
    },
  });
}

/** Bild: eigene Datei oder externe URL. Wird auch aus eingefügtem HTML (`<img>`) erkannt. */
export const Image = mediaNode('image').extend({
  parseHTML() {
    return [
      { tag: 'div[data-type="image"]' },
      {
        tag: 'img[src]',
        getAttrs: (el) => {
          const src = (el as HTMLElement).getAttribute('src') ?? '';
          // Eingefügte Bilder als data:-URL werden im Browser hochgeladen und ersetzt
          if (src.startsWith('data:image/')) return { src: null, pendingData: src };
          const safe = safeMediaSrc(src);
          if (!safe) return false;
          return { src: safe, caption: (el as HTMLElement).getAttribute('alt') ?? '' };
        },
      },
    ];
  },
  addAttributes() {
    return {
      ...commonAttrs(),
      /** Nur beim Einfügen: Bild als data:-URL. Der Browser entfernt es vor dem Einfügen und lädt hoch. */
      pendingData: { default: null, rendered: false },
      /** Kennung eines laufenden Uploads (kurzlebig, ohne Inhalt) */
      uploadId: { default: null, rendered: false },
    };
  },
  addCommands() {
    return {
      insertMedia:
        (type, attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type,
            attrs: { ...attrs, src: attrs.src ? safeMediaSrc(attrs.src) : null },
          }),
    };
  },
  renderHTML({ HTMLAttributes }) {
    const src = safeMediaSrc(HTMLAttributes['data-src']);
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'image' }),
      ['img', { src: src ?? '', alt: HTMLAttributes['data-caption'] ?? '' }],
    ];
  },
});

export const Video = mediaNode('video');
export const Audio = mediaNode('audio');
export const FileBlock = mediaNode('file');
export const Pdf = mediaNode('pdf');

/** Link-Vorschau. Titel, Beschreibung und Bild liefert der Server (OpenGraph). */
export const Bookmark = Node.create({
  name: 'bookmark',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      url: {
        default: null,
        parseHTML: (el) => safeExternalUrl(el.getAttribute('data-url')),
        renderHTML: (a) => (a.url ? { 'data-url': a.url } : {}),
      },
      title: dataAttr('title', 'title'),
      description: dataAttr('description', 'description'),
      image: {
        default: null,
        parseHTML: (el) => safeExternalUrl(el.getAttribute('data-image')),
        renderHTML: (a) => (a.image ? { 'data-image': a.image } : {}),
      },
      siteName: dataAttr('site-name', 'siteName'),
      favicon: {
        default: null,
        parseHTML: (el) => safeExternalUrl(el.getAttribute('data-favicon')),
        renderHTML: (a) => (a.favicon ? { 'data-favicon': a.favicon } : {}),
      },
      caption: dataAttr('caption', 'caption', ''),
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="bookmark"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    const url = safeExternalUrl(HTMLAttributes['data-url']);
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'bookmark' }),
      ['a', { href: url ?? '#', rel: 'noopener noreferrer nofollow' }, url ?? ''],
    ];
  },
  addCommands() {
    return {
      insertBookmark:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: 'bookmark',
            attrs: { url: safeExternalUrl(attrs.url) },
          }),
    };
  },
});

/** Einbettung eines erlaubten Anbieters (YouTube, Vimeo, Figma, Google Maps, ...). */
export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      url: {
        default: null,
        parseHTML: (el) => safeExternalUrl(el.getAttribute('data-url')),
        renderHTML: (a) => (a.url ? { 'data-url': a.url } : {}),
      },
      height: {
        default: null,
        parseHTML: (el) => {
          const n = Number.parseInt(el.getAttribute('data-height') ?? '', 10);
          return Number.isFinite(n) ? Math.min(1200, Math.max(120, n)) : null;
        },
        renderHTML: (a) => (a.height ? { 'data-height': String(a.height) } : {}),
      },
      width: {
        default: null,
        parseHTML: (el) => clampWidth(el.getAttribute('data-width')),
        renderHTML: (a) => (a.width ? { 'data-width': String(a.width) } : {}),
      },
      caption: dataAttr('caption', 'caption', ''),
    };
  },
  parseHTML() {
    return [
      { tag: 'div[data-type="embed"]' },
      {
        // iframes aus eingefügtem HTML nur übernehmen, wenn der Anbieter erlaubt ist
        tag: 'iframe[src]',
        getAttrs: (el) => {
          const src = (el as HTMLElement).getAttribute('src');
          return resolveEmbed(src) ? { url: src } : false;
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'embed' })];
  },
  addCommands() {
    return {
      insertEmbed:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({ type: 'embed', attrs: { url: safeExternalUrl(attrs.url) } }),
    };
  },
});
