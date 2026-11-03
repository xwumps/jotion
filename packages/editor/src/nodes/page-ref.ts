import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageRef: {
      /** Fügt einen Unterseiten-Block ein (Seite muss bereits existieren). */
      insertSubpage: (pageId: string) => ReturnType;
      /** Fügt einen Link auf eine bestehende Seite ein. */
      insertPageLink: (pageId: string) => ReturnType;
    };
  }
}

function pageRefNode(name: 'subpage' | 'pageLink') {
  return Node.create({
    name,
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
      return [{ tag: `div[data-type="${name}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes(HTMLAttributes, { 'data-type': name })];
    },
  });
}

/** Unterseite: Kindseite, die im Inhalt der Elternseite erscheint. */
export const Subpage = pageRefNode('subpage').extend({
  addCommands() {
    return {
      insertSubpage:
        (pageId) =>
        ({ commands }) =>
          commands.insertContent({ type: 'subpage', attrs: { pageId } }),
    };
  },
});

/** Link auf eine beliebige andere Seite. */
export const PageLink = pageRefNode('pageLink').extend({
  addCommands() {
    return {
      insertPageLink:
        (pageId) =>
        ({ commands }) =>
          commands.insertContent({ type: 'pageLink', attrs: { pageId } }),
    };
  },
});
