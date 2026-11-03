import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attrs?: { icon?: string }) => ReturnType;
      toggleCallout: () => ReturnType;
    };
  }
}

/** Hervorgehobener Kasten mit Emoji und beliebigen Blöcken als Inhalt. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      icon: {
        default: '💡',
        parseHTML: (el) => el.getAttribute('data-icon') ?? '💡',
        renderHTML: (attrs) => ({ 'data-icon': attrs.icon }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }), 0];
  },
  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attrs),
      toggleCallout:
        () =>
        ({ commands }) =>
          commands.toggleWrap(this.name),
    };
  },
});
