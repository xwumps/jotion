import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    syncedBlock: {
      /** Fügt einen Synced Block ein (Inhaltsseite muss bereits existieren). */
      insertSyncedBlock: (pageId: string) => ReturnType;
    };
  }
}

/**
 * Phase 10: Synced Block. Der Inhalt liegt in einer eigenen Seite (Art SYNCED_BLOCK) unter der
 * Ursprungsseite; jedes Vorkommen zeigt und bearbeitet dasselbe Dokument.
 */
export const SyncedBlock = Node.create({
  name: 'syncedBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      pageId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-page-id'),
        renderHTML: (attrs) => (attrs.pageId ? { 'data-page-id': attrs.pageId } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="syncedBlock"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'syncedBlock' })];
  },
  addCommands() {
    return {
      insertSyncedBlock:
        (pageId) =>
        ({ commands }) =>
          commands.insertContent({ type: 'syncedBlock', attrs: { pageId } }),
    };
  },
});

/** Text, der beim Einfügen zu einem weiteren Vorkommen des Synced Blocks wird */
export const SYNCED_TOKEN_PREFIX = 'jotion-synced:';
export const syncedToken = (pageId: string) => `${SYNCED_TOKEN_PREFIX}${pageId}`;
export function parseSyncedToken(text: string): string | null {
  const m = text
    .trim()
    .match(/^jotion-synced:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return m ? m[1]!.toLowerCase() : null;
}
