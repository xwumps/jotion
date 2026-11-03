import type { AnyExtension } from '@tiptap/core';
import { Extension, InputRule, wrappingInputRule } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import Blockquote from '@tiptap/extension-blockquote';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import UniqueID from '@tiptap/extension-unique-id';
import { Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { BLOCK_NODE_TYPES } from './constants';
import { BackgroundColor, BlockColor, TextColor } from './marks/colors';
import { Callout } from './nodes/callout';
import { PageLink, Subpage } from './nodes/page-ref';
import { Database } from './nodes/database';

export const lowlight = createLowlight(common);

/** Zitat wie bei Notion über `"` + Leerzeichen (">" ist für Toggles reserviert). */
const Quote = Blockquote.extend({
  addInputRules() {
    return [wrappingInputRule({ find: /^\s*["“„]\s$/, type: this.type })];
  },
});

/** Toggle über ">" + Leerzeichen. */
const Toggle = Details.extend({
  addInputRules() {
    return [
      new InputRule({
        find: /^>\s$/,
        handler: ({ range, chain }) => {
          // Wie bei Notion: neuer Toggle startet aufgeklappt, Enter im Titel führt in den Inhalt
          chain().deleteRange(range).setDetails().updateAttributes('details', { open: true }).run();
        },
      }),
    ];
  },
  // Das Plugin "detailsSelection" schiebt den Cursor aus scheinbar verstecktem Inhalt. Beim
  // Neuaufbau der Ansicht ist der Inhalt eines offenen Toggles kurz versteckt (setTimeout), dann
  // sprang der Cursor beim Tippen und Buchstaben landeten vertauscht oder hinter dem Toggle.
  addProseMirrorPlugins() {
    return [];
  },
}).configure({ persist: true, HTMLAttributes: { class: 'jt-toggle' } });

/**
 * Toggle-Inhalt: Sichtbarkeit wird aus dem Dokumentzustand (open) gesetzt statt umgeschaltet.
 * Das Original schaltet "hidden" bei jedem Ereignis um und startet immer versteckt.
 */
const ToggleContent = DetailsContent.extend({
  addNodeView() {
    return ({ HTMLAttributes, getPos, editor }) => {
      const dom = document.createElement('div');
      for (const [key, value] of Object.entries({
        ...HTMLAttributes,
        'data-type': 'detailsContent',
      }))
        dom.setAttribute(key, String(value));
      const parentOpen = () => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos === undefined) return false;
        const parent = editor.state.doc.resolve(pos).parent;
        return parent.type.name === 'details' && Boolean(parent.attrs.open);
      };
      const sync = () => {
        // Nach dem Umschalten trägt das Toggle-Element die Klasse "is-open"
        const details = dom.parentElement?.parentElement;
        const open = details ? details.classList.contains('is-open') || parentOpen() : parentOpen();
        dom.hidden = !open;
      };
      dom.hidden = !parentOpen();
      dom.addEventListener('toggleDetailsContent', () => {
        const details = dom.parentElement?.parentElement;
        dom.hidden = details ? !details.classList.contains('is-open') : !parentOpen();
      });
      return {
        dom,
        contentDOM: dom,
        ignoreMutation: (mutation) =>
          mutation.type === 'selection'
            ? false
            : !dom.contains(mutation.target) || dom === mutation.target,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'detailsContent') return false;
          sync();
          return true;
        },
      };
    };
  },
});

/**
 * Enter am Ende eines Toggle-Titels: in den Inhalt springen, entschieden nach dem Dokumentzustand.
 * Die Tiptap-Erweiterung prüft stattdessen, ob der Inhalt im DOM schon sichtbar ist; der wird
 * aber erst per setTimeout aufgeklappt. Auf langsamen Rechnern landete Text sonst hinter dem Toggle.
 */
const ToggleEnter = Extension.create({
  name: 'toggleEnter',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $head, empty } = state.selection;
        if (!empty || $head.parent.type.name !== 'detailsSummary') return false;
        if ($head.parentOffset !== $head.parent.content.size) return false;
        const details = $head.node(-1);
        if (details.type.name !== 'details' || !details.attrs.open) return false;
        const contentPos = $head.after();
        const content = state.doc.nodeAt(contentPos);
        if (!content || content.type.name !== 'detailsContent') return false;
        const tr = state.tr;
        const start = contentPos + 1;
        const first = content.firstChild;
        // Vorhandenen leeren Absatz nutzen, sonst einen neuen am Anfang einfügen
        if (!(first && first.isTextblock && first.content.size === 0))
          tr.insert(start, state.schema.nodes.paragraph!.create());
        tr.setSelection(TextSelection.create(tr.doc, start + 1)).scrollIntoView();
        editor.view.dispatch(tr);
        return true;
      },
    };
  },
});

export interface ExtensionOptions {
  /** Platzhaltertext je Knoten (leer = kein Platzhalter) */
  placeholder?: (nodeType: string, level?: number) => string;
  /** Ersetzt einzelne Erweiterungen, z. B. mit React-NodeViews (Name muss gleich bleiben) */
  overrides?: AnyExtension[];
  /** Zusätzliche Erweiterungen (z. B. Collaboration, Slash-Menü) */
  extra?: AnyExtension[];
  /** Mit Collaboration übernimmt Yjs Undo/Redo */
  collaborative?: boolean;
}

/** Alle Inhalts-Erweiterungen von Jotion. Gleiches Schema in Browser und Tests. */
export function jotionExtensions(options: ExtensionOptions = {}): AnyExtension[] {
  const base: AnyExtension[] = [
    StarterKit.configure({
      blockquote: false,
      codeBlock: false,
      undoRedo: options.collaborative ? false : undefined,
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      },
      heading: { levels: [1, 2, 3] },
      dropcursor: { color: 'var(--accent)', width: 3 },
    }),
    Quote,
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: 'plaintext' }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Toggle,
    ToggleEnter,
    DetailsSummary,
    ToggleContent,
    Callout,
    Subpage,
    PageLink,
    TextColor,
    BackgroundColor,
    BlockColor,
    UniqueID.configure({
      types: [...BLOCK_NODE_TYPES],
      attributeName: 'id',
      // Fremde (Yjs-)Transaktionen nicht anfassen, sonst entstehen Endlosschleifen
      filterTransaction: (tr) => !tr.getMeta('y-sync$'),
    }),
    Database,
  ];
  if (options.placeholder) {
    const ph = options.placeholder;
    base.push(
      Placeholder.configure({
        includeChildren: true,
        placeholder: ({ node }) => ph(node.type.name, node.attrs.level as number | undefined),
      }),
    );
  }
  const overrides = new Map((options.overrides ?? []).map((e) => [e.name, e]));
  return [...base.map((e) => overrides.get(e.name) ?? e), ...(options.extra ?? [])];
}
