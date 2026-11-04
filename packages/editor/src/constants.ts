/** Name des Y.XmlFragment, in dem Tiptap (Collaboration) den Inhalt speichert. */
export const DOC_FRAGMENT = 'default';

/** Dokumentname im Collab-Server für eine Seite. */
export const pageDocName = (pageId: string) => `page:${pageId}`;
export const pageIdFromDocName = (name: string): string | null =>
  name.startsWith('page:') ? name.slice(5) : null;

/** Knotentypen, die eine stabile Block-ID tragen (Attribut "id"). */
export const BLOCK_NODE_TYPES = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'details',
  'callout',
  'subpage',
  'pageLink',
  'image',
  'video',
  'audio',
  'file',
  'pdf',
  'bookmark',
  'embed',
  'table',
  'columnList',
  'column',
  'tableOfContents',
  'breadcrumb',
  'mathBlock',
  'database',
] as const;

/** Knoten mit Hintergrund-/Textfarbe auf Blockebene. */
export const COLORABLE_NODE_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'listItem',
  'taskItem',
  'details',
  'callout',
] as const;

export const CONTENT_COLOR_NAMES = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;
export type ContentColorName = (typeof CONTENT_COLOR_NAMES)[number];

/** Knoten, die auf eine andere Seite verweisen (Attribut pageId). */
export const PAGE_REFERENCE_NODES = ['subpage', 'pageLink'] as const;
