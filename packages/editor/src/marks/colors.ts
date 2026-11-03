import { Extension, Mark, mergeAttributes } from '@tiptap/core';
import { COLORABLE_NODE_TYPES, type ContentColorName } from '../constants';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    contentColor: {
      setTextColor: (color: ContentColorName) => ReturnType;
      setBackgroundColor: (color: ContentColorName) => ReturnType;
      unsetColors: () => ReturnType;
      setBlockColor: (color: string | null) => ReturnType;
    };
  }
}

/**
 * Farben als benannte Werte (z. B. "red", "blue_background") statt Hexcodes,
 * damit sie im hellen und dunklen Design passend dargestellt werden.
 */
export const TextColor = Mark.create({
  name: 'textColor',
  addAttributes() {
    return {
      color: {
        default: 'default',
        parseHTML: (el) => el.getAttribute('data-color'),
        renderHTML: (a) => ({ 'data-color': a.color }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-color]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'jt-color' }), 0];
  },
});

export const BackgroundColor = Mark.create({
  name: 'backgroundColor',
  addAttributes() {
    return {
      color: {
        default: 'default',
        parseHTML: (el) => el.getAttribute('data-bg'),
        renderHTML: (a) => ({ 'data-bg': a.color }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-bg]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'jt-bg' }), 0];
  },
});

/** Farbe auf Blockebene ("blockColor": "red" oder "red_background"). */
export const BlockColor = Extension.create({
  name: 'blockColor',
  addGlobalAttributes() {
    return [
      {
        types: [...COLORABLE_NODE_TYPES],
        attributes: {
          blockColor: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-block-color'),
            renderHTML: (a) => (a.blockColor ? { 'data-block-color': a.blockColor } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ chain }) =>
          color === 'default'
            ? chain().unsetMark('textColor').run()
            : chain().setMark('textColor', { color }).run(),
      setBackgroundColor:
        (color) =>
        ({ chain }) =>
          color === 'default'
            ? chain().unsetMark('backgroundColor').run()
            : chain().setMark('backgroundColor', { color }).run(),
      unsetColors:
        () =>
        ({ chain }) =>
          chain().unsetMark('textColor').unsetMark('backgroundColor').run(),
      setBlockColor:
        (color) =>
        ({ tr, state, dispatch }) => {
          const { $from } = state.selection;
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if ((COLORABLE_NODE_TYPES as readonly string[]).includes(node.type.name)) {
              if (dispatch)
                tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, blockColor: color });
              return true;
            }
          }
          return false;
        },
    };
  },
});
