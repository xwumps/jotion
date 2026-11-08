import * as Y from 'yjs';
import { BLOCK_NODE_TYPES, DOC_FRAGMENT, PAGE_REFERENCE_NODES } from './constants';
import { mentionText } from './nodes/inline';
import { fileIdFromUrl } from './urls';

export interface ProjectedBlock {
  id: string;
  parentId: string | null;
  type: string;
  position: number;
  text: string;
  props: Record<string, unknown>;
}

export interface ProjectedReference {
  blockId: string;
  /** page: Unterseite, Seitenlink oder @Seite; user: @Person; file: hochgeladene Datei */
  targetType: 'page' | 'user' | 'file';
  targetId: string;
}

export interface Projection {
  blocks: ProjectedBlock[];
  references: ProjectedReference[];
  /** Gesamter Klartext (für die Volltextsuche) */
  text: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROP_KEYS = [
  'level',
  'checked',
  'language',
  'pageId',
  'blockColor',
  'icon',
  'open',
  'start',
  // Phase 3: Medien, Bookmark, Embed, Formeln, Spalten
  'src',
  'url',
  'name',
  'mime',
  'size',
  'width',
  'align',
  'caption',
  'title',
  'latex',
  // Phase 4: Inline-Datenbank
  'databaseId',
  'viewId',
];
/** Attribute, deren Text bei Blöcken ohne eigenen Fließtext durchsuchbar sein soll */
const ATOM_TEXT_KEYS: Record<string, string[]> = {
  image: ['caption'],
  video: ['caption', 'name'],
  audio: ['caption', 'name'],
  file: ['name', 'caption'],
  pdf: ['name', 'caption'],
  bookmark: ['title', 'description', 'url', 'caption'],
  embed: ['caption', 'url'],
  mathBlock: ['latex'],
};
const MAX_PROP_STRING = 2000;

function inlineElementText(el: Y.XmlElement): string {
  const attrs = el.getAttributes() as Record<string, unknown>;
  if (el.nodeName === 'mention') return mentionText(attrs);
  if (el.nodeName === 'mathInline') return typeof attrs.latex === 'string' ? attrs.latex : '';
  return '';
}

function inlineText(el: Y.XmlElement): string {
  let out = '';
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlText) {
      for (const op of child.toDelta() as { insert: unknown }[])
        if (typeof op.insert === 'string') out += op.insert;
    } else if (child instanceof Y.XmlElement && !child.getAttribute('id')) {
      out += inlineElementText(child);
    }
  }
  return out;
}

function atomText(type: string, attrs: Record<string, unknown>): string {
  const keys = ATOM_TEXT_KEYS[type];
  if (!keys) return '';
  return keys
    .map((k) => attrs[k])
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join(' ');
}

/**
 * Leitet Blöcke und Verweise aus dem Yjs-Dokument ab, ohne ProseMirror-Schema.
 * Knoten ohne id (z. B. Text-Container, Tabellenzeilen) werden durchlaufen, aber nicht als Block erfasst.
 */
export function projectDoc(doc: Y.Doc): Projection {
  const blocks: ProjectedBlock[] = [];
  const references: ProjectedReference[] = [];
  const texts: string[] = [];
  const seen = new Set<string>();
  const refSeen = new Set<string>();
  const addRef = (r: ProjectedReference) => {
    const key = `${r.blockId}|${r.targetId}`;
    if (refSeen.has(key)) return;
    refSeen.add(key);
    references.push(r);
  };

  const walk = (parent: Y.XmlFragment | Y.XmlElement, parentId: string | null) => {
    let position = 0;
    for (const child of parent.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      const attrs = child.getAttributes() as Record<string, unknown>;
      const type = child.nodeName;
      // Erwähnungen im Fließtext: Verweis vom umgebenden Block
      if (type === 'mention' && parentId) {
        const target = attrs.targetId;
        if (
          (attrs.kind === 'user' || attrs.kind === 'page') &&
          typeof target === 'string' &&
          UUID_RE.test(target)
        )
          addRef({ blockId: parentId, targetType: attrs.kind, targetId: target.toLowerCase() });
        continue;
      }
      const rawId = typeof attrs.id === 'string' ? attrs.id : null;
      // Doppelte IDs (z. B. nach Einfügen) nur einmal erfassen
      const id = rawId && !seen.has(rawId) ? rawId : null;
      if (id) {
        seen.add(id);
        const text = [inlineText(child), atomText(type, attrs)].filter(Boolean).join(' ');
        if (text) texts.push(text);
        const props: Record<string, unknown> = {};
        for (const k of PROP_KEYS) {
          const v = attrs[k];
          if (v === undefined || v === null || v === '') continue;
          props[k] = typeof v === 'string' ? v.slice(0, MAX_PROP_STRING) : v;
        }
        blocks.push({ id, parentId, type, position: position++, text, props });
        // Inline-Datenbank verweist auf die Datenbankseite (Phase 4)
        if (
          (type === 'database' || type === 'chart') &&
          typeof attrs.databaseId === 'string' &&
          UUID_RE.test(attrs.databaseId)
        ) {
          addRef({ blockId: id, targetType: 'page', targetId: attrs.databaseId.toLowerCase() });
        }
        if (
          (PAGE_REFERENCE_NODES as readonly string[]).includes(type) &&
          typeof attrs.pageId === 'string' &&
          UUID_RE.test(attrs.pageId)
        ) {
          addRef({ blockId: id, targetType: 'page', targetId: attrs.pageId.toLowerCase() });
        }
        const fileId = fileIdFromUrl(attrs.src);
        if (fileId) addRef({ blockId: id, targetType: 'file', targetId: fileId });
      }
      walk(child, id ?? parentId);
    }
  };
  walk(doc.getXmlFragment(DOC_FRAGMENT), null);
  return { blocks, references, text: texts.join('\n') };
}

export interface PMJson {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMJson[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

/** Markennamen von y-prosemirror tragen bei überlappenden Marken ein Suffix ("bold--a1b2c3d4"). */
const markName = (key: string) => key.replace(/--[A-Za-z0-9+/=]{8}$/, '');

/**
 * Dokument als ProseMirror-JSON (wie y-prosemirror), ohne Schema. Für Druckansicht und Export.
 */
export function docToJson(doc: Y.Doc): PMJson {
  const serialize = (item: Y.XmlElement | Y.XmlText): PMJson[] => {
    if (item instanceof Y.XmlText) {
      return (item.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[])
        .filter((d) => typeof d.insert === 'string' && d.insert.length > 0)
        .map((d) => {
          const node: PMJson = { type: 'text', text: d.insert as string };
          if (d.attributes && Object.keys(d.attributes).length) {
            node.marks = Object.entries(d.attributes).map(([k, v]) => {
              const attrs = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
              return Object.keys(attrs).length
                ? { type: markName(k), attrs }
                : { type: markName(k) };
            });
          }
          return node;
        });
    }
    const node: PMJson = { type: item.nodeName };
    const attrs = item.getAttributes() as Record<string, unknown>;
    if (Object.keys(attrs).length) node.attrs = attrs;
    const children = item
      .toArray()
      .filter(
        (c): c is Y.XmlElement | Y.XmlText => c instanceof Y.XmlElement || c instanceof Y.XmlText,
      )
      .flatMap(serialize);
    if (children.length) node.content = children;
    return [node];
  };
  const fragment = doc.getXmlFragment(DOC_FRAGMENT);
  return {
    type: 'doc',
    content: fragment
      .toArray()
      .filter(
        (c): c is Y.XmlElement | Y.XmlText => c instanceof Y.XmlElement || c instanceof Y.XmlText,
      )
      .flatMap(serialize),
  };
}

/**
 * Setzt in allen Unterseiten-Blöcken die pageId gemäß map um (Seite duplizieren).
 * Unterseiten-Blöcke ohne Eintrag in map werden entfernt (nicht mitkopierte Seiten).
 */
export function remapSubpages(doc: Y.Doc, map: Map<string, string>): void {
  doc.transact(() => {
    const visit = (parent: Y.XmlFragment | Y.XmlElement) => {
      const children = parent.toArray();
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        if (!(child instanceof Y.XmlElement)) continue;
        if (child.nodeName === 'subpage') {
          const target = map.get(String(child.getAttribute('pageId') ?? '').toLowerCase());
          if (target) child.setAttribute('pageId', target);
          else parent.delete(i, 1);
        } else visit(child);
      }
    };
    visit(doc.getXmlFragment(DOC_FRAGMENT));
  }, 'jotion-server');
}

/** Seiten-IDs, auf die Unterseiten-Blöcke im Dokument zeigen. */
export function subpageIds(doc: Y.Doc): string[] {
  return projectDoc(doc)
    .blocks.filter((b) => b.type === 'subpage' && typeof b.props.pageId === 'string')
    .map((b) => b.props.pageId as string);
}

/**
 * Hängt einen Unterseiten-Block ans Ende des Dokuments, falls noch keiner für diese Seite existiert.
 * Arbeitet direkt auf Yjs (serverseitig, ohne Editor). Liefert true, wenn eingefügt wurde.
 */
export function appendSubpageBlock(doc: Y.Doc, pageId: string, blockId: string): boolean {
  if (subpageIds(doc).includes(pageId)) return false;
  doc.transact(() => {
    const el = new Y.XmlElement('subpage');
    el.setAttribute('id', blockId);
    el.setAttribute('pageId', pageId);
    doc.getXmlFragment(DOC_FRAGMENT).push([el]);
  }, 'jotion-server');
  return true;
}

/**
 * Hängt Text als Absätze ans Ende des Dokuments (serverseitig, z. B. Beschreibung eines
 * synchronisierten Termins). Jede nicht leere Zeile wird ein Absatz.
 */
export function appendTextParagraphs(doc: Y.Doc, text: string, newId: () => string): number {
  const paras = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!paras.length) return 0;
  doc.transact(() => {
    const els = paras.map((p) => {
      const el = new Y.XmlElement('paragraph');
      el.setAttribute('id', newId());
      el.insert(0, [new Y.XmlText(p)]);
      return el;
    });
    doc.getXmlFragment(DOC_FRAGMENT).push(els);
  }, 'jotion-server');
  return paras.length;
}

/** Entfernt alle Unterseiten-Blöcke für eine Seite (z. B. nach Verschieben). Liefert die Anzahl. */
export function removeSubpageBlocks(doc: Y.Doc, pageId: string): number {
  let removed = 0;
  doc.transact(() => {
    const visit = (parent: Y.XmlFragment | Y.XmlElement) => {
      const children = parent.toArray();
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        if (!(child instanceof Y.XmlElement)) continue;
        if (child.nodeName === 'subpage' && child.getAttribute('pageId') === pageId) {
          parent.delete(i, 1);
          removed++;
        } else visit(child);
      }
    };
    visit(doc.getXmlFragment(DOC_FRAGMENT));
  }, 'jotion-server');
  return removed;
}

/** Attribute, die auf Seiten, Datenbanken oder Ansichten zeigen (beim Kopieren umschreiben). */
const ID_ATTRIBUTES = ['pageId', 'databaseId', 'viewId', 'targetId'] as const;

/**
 * Phase 9: Verweise in einem kopierten Dokument auf die Kopien umschreiben. Unterseiten- und
 * Datenbank-Blöcke ohne Kopie werden entfernt (sie gehörten zum Original); Erwähnungen und Links
 * auf Seiten außerhalb der Kopie bleiben.
 */
export function remapDocIds(doc: Y.Doc, map: Map<string, string>): void {
  doc.transact(() => {
    const visit = (parent: Y.XmlFragment | Y.XmlElement) => {
      const children = parent.toArray();
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        if (child instanceof Y.XmlText) {
          // Inline-Erwähnungen stehen als Einbettungen im Text
          continue;
        }
        if (!(child instanceof Y.XmlElement)) continue;
        let owned = false;
        let missing = false;
        for (const key of ID_ATTRIBUTES) {
          const v = child.getAttribute(key);
          if (typeof v !== 'string' || !v) continue;
          const target = map.get(v.toLowerCase());
          if (target) {
            child.setAttribute(key, target);
            owned = true;
          } else if (key === 'pageId' || key === 'databaseId') missing = true;
        }
        if (missing && !owned && (child.nodeName === 'subpage' || child.nodeName === 'database')) {
          parent.delete(i, 1);
          continue;
        }
        visit(child);
      }
    };
    visit(doc.getXmlFragment(DOC_FRAGMENT));
  }, 'jotion-server');
}

/**
 * Phase 9: Platzhalter im Text ersetzen (z. B. "@heute" → Datum). Formatierungen bleiben,
 * ersetzt wird je zusammenhängendem Textstück.
 */
export function replaceTextVariables(doc: Y.Doc, vars: Record<string, string>): number {
  const names = Object.keys(vars).sort((a, b) => b.length - a.length);
  if (!names.length) return 0;
  const re = new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  let count = 0;
  doc.transact(() => {
    const visitText = (text: Y.XmlText) => {
      const delta = text.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[];
      let offset = 0;
      const edits: { at: number; len: number; value: string; attrs?: Record<string, unknown> }[] =
        [];
      for (const op of delta) {
        if (typeof op.insert !== 'string') {
          offset += 1;
          continue;
        }
        for (const m of op.insert.matchAll(re))
          edits.push({
            at: offset + m.index!,
            len: m[0].length,
            value: vars[m[0]]!,
            attrs: op.attributes,
          });
        offset += op.insert.length;
      }
      // Von hinten, damit die Positionen stimmen
      for (const e of edits.reverse()) {
        text.delete(e.at, e.len);
        text.insert(e.at, e.value, e.attrs ?? {});
        count++;
      }
    };
    const visit = (parent: Y.XmlFragment | Y.XmlElement) => {
      for (const child of parent.toArray()) {
        if (child instanceof Y.XmlText) visitText(child);
        else if (child instanceof Y.XmlElement) visit(child);
      }
    };
    visit(doc.getXmlFragment(DOC_FRAGMENT));
  }, 'jotion-server');
  return count;
}

/** Knoten im ProseMirror-JSON-Format (für mitgelieferte Vorlagen). */
export interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

const BLOCK_TYPES = new Set<string>(BLOCK_NODE_TYPES);

/**
 * Phase 9: Inhalt aus ProseMirror-JSON ans Dokument hängen (wie y-prosemirror: Element je Knoten,
 * Text mit Marks als Formatierung). Blöcke ohne id bekommen eine neue.
 */
export function appendPmContent(doc: Y.Doc, nodes: PmNode[], newId: () => string): void {
  const build = (n: PmNode): Y.XmlElement => {
    const el = new Y.XmlElement(n.type);
    for (const [k, v] of Object.entries(n.attrs ?? {}))
      if (v !== null && v !== undefined) el.setAttribute(k, v as string);
    if (BLOCK_TYPES.has(n.type) && !n.attrs?.id) el.setAttribute('id', newId());
    const children: (Y.XmlElement | Y.XmlText)[] = [];
    let text: Y.XmlText | null = null;
    // Länge selbst zählen: ein noch nicht eingehängter Text meldet immer 0
    let textLength = 0;
    for (const c of n.content ?? []) {
      if (c.type === 'text') {
        if (!text) {
          text = new Y.XmlText();
          textLength = 0;
          children.push(text);
        }
        const attrs: Record<string, unknown> = {};
        for (const m of c.marks ?? []) attrs[m.type] = m.attrs ?? {};
        text.insert(textLength, c.text ?? '', attrs);
        textLength += (c.text ?? '').length;
      } else {
        text = null;
        children.push(build(c));
      }
    }
    if (children.length) el.insert(0, children);
    return el;
  };
  doc.transact(() => {
    doc.getXmlFragment(DOC_FRAGMENT).push(nodes.map(build));
  }, 'jotion-server');
}
