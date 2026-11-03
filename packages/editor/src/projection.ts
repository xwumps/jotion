import * as Y from 'yjs';
import { DOC_FRAGMENT, PAGE_REFERENCE_NODES } from './constants';

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
  targetType: 'page';
  targetId: string;
}

export interface Projection {
  blocks: ProjectedBlock[];
  references: ProjectedReference[];
  /** Gesamter Klartext (für spätere Volltextsuche) */
  text: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROP_KEYS = ['level', 'checked', 'language', 'pageId', 'blockColor', 'icon', 'open', 'start'];

function inlineText(el: Y.XmlElement): string {
  let out = '';
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlText) {
      for (const op of child.toDelta() as { insert: unknown }[])
        if (typeof op.insert === 'string') out += op.insert;
    }
  }
  return out;
}

/**
 * Leitet Blöcke und Seitenverweise aus dem Yjs-Dokument ab, ohne ProseMirror-Schema.
 * Knoten ohne id (z. B. Text-Container) werden durchlaufen, aber nicht als Block erfasst.
 */
export function projectDoc(doc: Y.Doc): Projection {
  const blocks: ProjectedBlock[] = [];
  const references: ProjectedReference[] = [];
  const texts: string[] = [];
  const seen = new Set<string>();

  const walk = (parent: Y.XmlFragment | Y.XmlElement, parentId: string | null) => {
    let position = 0;
    for (const child of parent.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      const attrs = child.getAttributes() as Record<string, unknown>;
      const rawId = typeof attrs.id === 'string' ? attrs.id : null;
      // Doppelte IDs (z. B. nach Einfügen) nur einmal erfassen
      const id = rawId && !seen.has(rawId) ? rawId : null;
      if (id) {
        seen.add(id);
        const text = inlineText(child);
        if (text) texts.push(text);
        const props: Record<string, unknown> = {};
        for (const k of PROP_KEYS)
          if (attrs[k] !== undefined && attrs[k] !== null) props[k] = attrs[k];
        blocks.push({ id, parentId, type: child.nodeName, position: position++, text, props });
        if (
          (PAGE_REFERENCE_NODES as readonly string[]).includes(child.nodeName) &&
          typeof attrs.pageId === 'string' &&
          UUID_RE.test(attrs.pageId)
        ) {
          references.push({
            blockId: id,
            targetType: 'page',
            targetId: attrs.pageId.toLowerCase(),
          });
        }
      }
      walk(child, id ?? parentId);
    }
  };
  walk(doc.getXmlFragment(DOC_FRAGMENT), null);
  return { blocks, references, text: texts.join('\n') };
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
