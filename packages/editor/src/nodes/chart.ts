import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    chart: {
      /** Fügt ein Diagramm ein (Chart-Ansicht einer Datenbank, muss bereits existieren). */
      insertChart: (databaseId: string, viewId: string) => ReturnType;
    };
  }
}

/**
 * Diagramm-Block (Phase 7): zeigt die Chart-Ansicht viewId der Datenbank databaseId.
 * Die Darstellung rendert die Web-App als Node-View.
 */
export const Chart = Node.create({
  name: 'chart',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      databaseId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-database-id'),
        renderHTML: (attrs) => (attrs.databaseId ? { 'data-database-id': attrs.databaseId } : {}),
      },
      viewId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-view-id'),
        renderHTML: (attrs) => (attrs.viewId ? { 'data-view-id': attrs.viewId } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="chart"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'chart' })];
  },
  addCommands() {
    return {
      insertChart:
        (databaseId, viewId) =>
        ({ commands }) =>
          commands.insertContent({ type: 'chart', attrs: { databaseId, viewId } }),
    };
  },
});
