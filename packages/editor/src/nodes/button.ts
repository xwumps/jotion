import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    buttonBlock: {
      /** Fügt einen Button ein (Automatisierung wird in der Web-App zugeordnet). */
      insertButton: (attrs?: { label?: string; automationId?: string | null }) => ReturnType;
    };
  }
}

/**
 * Button-Block (Phase 9): löst beim Klick eine Automatisierung aus (Auslöser "Button" ohne
 * Datenbank). Die Darstellung rendert die Web-App als Node-View.
 */
export const ButtonBlock = Node.create({
  name: 'buttonBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-label') ?? '',
        renderHTML: (attrs) => ({ 'data-label': attrs.label }),
      },
      automationId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-automation-id'),
        renderHTML: (attrs) =>
          attrs.automationId ? { 'data-automation-id': attrs.automationId } : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="button"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'button' })];
  },
  addCommands() {
    return {
      insertButton:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: 'buttonBlock',
            attrs: { label: attrs?.label ?? '', automationId: attrs?.automationId ?? null },
          }),
    };
  },
});
