import type { AnyExtension } from '@tiptap/core';
import { InputRule, wrappingInputRule } from '@tiptap/core';
import Blockquote from '@tiptap/extension-blockquote';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import UniqueID from '@tiptap/extension-unique-id';
import { Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { common, createLowlight } from 'lowlight';
import { BLOCK_NODE_TYPES } from './constants';
import { BackgroundColor, BlockColor, TextColor } from './marks/colors';
import { Callout } from './nodes/callout';
import { PageLink, Subpage } from './nodes/page-ref';
import { BlockSelection } from './block-selection';
import { MathBlock, MathInline, Mention } from './nodes/inline';
import { Breadcrumb, Column, ColumnList, TableOfContents } from './nodes/layout';
import { Audio, Bookmark, Embed, FileBlock, Image, Pdf, Video } from './nodes/media';

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
}).configure({ persist: true, HTMLAttributes: { class: 'jt-toggle' } });

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
    DetailsSummary,
    DetailsContent,
    Callout,
    Subpage,
    PageLink,
    TextColor,
    BackgroundColor,
    BlockColor,
    Image,
    Video,
    Audio,
    FileBlock,
    Pdf,
    Bookmark,
    Embed,
    Table.configure({ resizable: true, HTMLAttributes: { class: 'jt-table' } }),
    TableRow,
    TableHeader,
    TableCell,
    ColumnList,
    Column,
    TableOfContents,
    Breadcrumb,
    MathBlock,
    MathInline,
    Mention,
    BlockSelection,
    UniqueID.configure({
      types: [...BLOCK_NODE_TYPES],
      attributeName: 'id',
      // Fremde (Yjs-)Transaktionen nicht anfassen, sonst entstehen Endlosschleifen
      filterTransaction: (tr) => !tr.getMeta('y-sync$'),
    }),
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
