import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    database: {
      /** Fügt eine Inline-Datenbank ein (Datenbank muss bereits existieren). */
      insertDatabase: (databaseId: string) => ReturnType;
    };
  }
}

/**
 * Inline-Datenbank (Phase 4): Block, der eine Datenbank (oder Linked Database) im Inhalt zeigt.
 * Attribut databaseId = ID der Datenbankseite. Die Ansicht rendert die Web-App als Node-View.
 */
export const Database = Node.create({
  name: 'database',
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
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="database"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'database' })];
  },
  addCommands() {
    return {
      insertDatabase:
        (databaseId) =>
        ({ commands }) =>
          commands.insertContent({ type: 'database', attrs: { databaseId } }),
    };
  },
});
