import type { Editor, Range } from '@tiptap/core';
import {
  CheckSquare,
  ChevronRight,
  Code,
  Columns2,
  Columns3,
  Columns4,
  File as FileIcon,
  Database,
  FileText,
  Film,
  Globe,
  ImageIcon,
  ListTree,
  Bookmark,
  Music,
  Navigation,
  Radical,
  Sigma,
  Table,
  Heading1,
  Heading2,
  Heading3,
  Link2,
  List,
  ListOrdered,
  Lightbulb,
  Minus,
  Quote,
  Sheet,
  Table2,
  Type,
  type LucideIcon,
} from 'lucide-react';

export interface CommandContext {
  createSubpage: () => Promise<string | null>;
  pickPage: () => Promise<string | null>;
  /** Phase 4: Datenbank unter der aktuellen Seite anlegen (inline, ganzseitig oder verknüpft) */
  createDatabase?: (opts: { inline: boolean; sourceDatabaseId?: string }) => Promise<string | null>;
}

export interface BlockCommand {
  id: string;
  icon: LucideIcon;
  /** Suchbegriffe (deutsch und englisch) */
  aliases: string[];
  /** Kann ein bestehender Block in diesen Typ umgewandelt werden? */
  turnInto?: boolean;
  /** Markdown-Kürzel zur Anzeige */
  shortcut?: string;
  run: (editor: Editor, range: Range | null, ctx: CommandContext) => void | Promise<void>;
}

const chainAt = (editor: Editor, range: Range | null) =>
  range ? editor.chain().focus().deleteRange(range) : editor.chain().focus();

/** Alle Blocktypen für Slash-Menü und "Umwandeln in". */
export const BLOCK_COMMANDS: BlockCommand[] = [
  {
    id: 'text',
    icon: Type,
    aliases: ['text', 'absatz', 'paragraph'],
    turnInto: true,
    run: (e, r) => void chainAt(e, r).setParagraph().run(),
  },
  {
    id: 'h1',
    icon: Heading1,
    aliases: ['überschrift 1', 'heading 1', 'h1', 'titel'],
    turnInto: true,
    shortcut: '#',
    run: (e, r) => void chainAt(e, r).setHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    icon: Heading2,
    aliases: ['überschrift 2', 'heading 2', 'h2'],
    turnInto: true,
    shortcut: '##',
    run: (e, r) => void chainAt(e, r).setHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    icon: Heading3,
    aliases: ['überschrift 3', 'heading 3', 'h3'],
    turnInto: true,
    shortcut: '###',
    run: (e, r) => void chainAt(e, r).setHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet',
    icon: List,
    aliases: ['aufzählung', 'liste', 'bullet', 'list', 'ul'],
    turnInto: true,
    shortcut: '-',
    run: (e, r) => void chainAt(e, r).toggleBulletList().run(),
  },
  {
    id: 'numbered',
    icon: ListOrdered,
    aliases: ['nummerierte liste', 'numbered', 'ordered', 'ol', '1.'],
    turnInto: true,
    shortcut: '1.',
    run: (e, r) => void chainAt(e, r).toggleOrderedList().run(),
  },
  {
    id: 'todo',
    icon: CheckSquare,
    aliases: ['to-do', 'todo', 'aufgabe', 'checkbox', 'task'],
    turnInto: true,
    shortcut: '[]',
    run: (e, r) => void chainAt(e, r).toggleTaskList().run(),
  },
  {
    id: 'toggle',
    icon: ChevronRight,
    aliases: ['toggle', 'aufklappen', 'details'],
    turnInto: true,
    shortcut: '>',
    run: (e, r) =>
      void chainAt(e, r).setDetails().updateAttributes('details', { open: true }).run(),
  },
  {
    id: 'quote',
    icon: Quote,
    aliases: ['zitat', 'quote', 'blockquote'],
    turnInto: true,
    shortcut: '"',
    run: (e, r) => void chainAt(e, r).toggleBlockquote().run(),
  },
  {
    id: 'callout',
    icon: Lightbulb,
    aliases: ['callout', 'hinweis', 'kasten', 'info'],
    turnInto: true,
    run: (e, r) => void chainAt(e, r).setCallout().run(),
  },
  {
    id: 'code',
    icon: Code,
    aliases: ['code', 'codeblock', 'programm'],
    turnInto: true,
    shortcut: '```',
    run: (e, r) => void chainAt(e, r).toggleCodeBlock().run(),
  },
  {
    id: 'divider',
    icon: Minus,
    aliases: ['trennlinie', 'divider', 'linie', 'hr'],
    shortcut: '---',
    run: (e, r) => void chainAt(e, r).setHorizontalRule().run(),
  },
  // Phase 3: Medien, Einbettungen, Layout, Formeln
  {
    id: 'image',
    icon: ImageIcon,
    aliases: ['bild', 'image', 'foto', 'picture', 'img'],
    run: (e, r) => void chainAt(e, r).insertMedia('image').run(),
  },
  {
    id: 'video',
    icon: Film,
    aliases: ['video', 'film', 'clip'],
    run: (e, r) => void chainAt(e, r).insertMedia('video').run(),
  },
  {
    id: 'audio',
    icon: Music,
    aliases: ['audio', 'ton', 'musik', 'sound', 'mp3'],
    run: (e, r) => void chainAt(e, r).insertMedia('audio').run(),
  },
  {
    id: 'file',
    icon: FileIcon,
    aliases: ['datei', 'file', 'anhang', 'upload', 'attachment'],
    run: (e, r) => void chainAt(e, r).insertMedia('file').run(),
  },
  {
    id: 'pdf',
    icon: FileText,
    aliases: ['pdf', 'dokument'],
    run: (e, r) => void chainAt(e, r).insertMedia('pdf').run(),
  },
  {
    id: 'bookmark',
    icon: Bookmark,
    aliases: ['lesezeichen', 'bookmark', 'link-vorschau', 'web'],
    run: (e, r) => void chainAt(e, r).insertBookmark().run(),
  },
  {
    id: 'embed',
    icon: Globe,
    aliases: ['einbetten', 'embed', 'youtube', 'vimeo', 'figma', 'maps', 'karte', 'iframe'],
    run: (e, r) => void chainAt(e, r).insertEmbed().run(),
  },
  {
    id: 'table',
    icon: Table,
    aliases: ['tabelle', 'table', 'raster'],
    run: (e, r) => void chainAt(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  ...([2, 3, 4, 5] as const).map<BlockCommand>((n) => ({
    id: `columns${n}`,
    icon: n === 2 ? Columns2 : n === 3 ? Columns3 : Columns4,
    aliases: [`${n} spalten`, `${n} columns`, 'spalten', 'columns', 'layout'],
    run: (e, r) => void chainAt(e, r).insertColumns(n).run(),
  })),
  {
    id: 'toc',
    icon: ListTree,
    aliases: ['inhaltsverzeichnis', 'table of contents', 'toc', 'inhalt'],
    run: (e, r) => void chainAt(e, r).insertTableOfContents().run(),
  },
  {
    id: 'breadcrumb',
    icon: Navigation,
    aliases: ['breadcrumb', 'pfad', 'navigation'],
    run: (e, r) => void chainAt(e, r).insertBreadcrumb().run(),
  },
  {
    id: 'math',
    icon: Sigma,
    aliases: ['formel', 'gleichung', 'math', 'equation', 'katex', 'latex', 'tex'],
    run: (e, r) => void chainAt(e, r).insertMathBlock().run(),
  },
  {
    id: 'mathInline',
    icon: Radical,
    aliases: ['inline-formel', 'inline equation', 'inline math'],
    run: (e, r) => void chainAt(e, r).insertMathInline('x').run(),
  },
  {
    id: 'page',
    icon: FileText,
    aliases: ['seite', 'unterseite', 'page', 'subpage'],
    run: async (e, r, ctx) => {
      if (r) e.chain().focus().deleteRange(r).run();
      const id = await ctx.createSubpage();
      if (id) e.chain().focus().insertSubpage(id).run();
    },
  },
  {
    id: 'pageLink',
    icon: Link2,
    aliases: ['link zu seite', 'seitenlink', 'link to page', 'verweis'],
    run: async (e, r, ctx) => {
      if (r) e.chain().focus().deleteRange(r).run();
      const id = await ctx.pickPage();
      if (id) e.chain().focus().insertPageLink(id).run();
    },
  },
  {
    id: 'database',
    icon: Table2,
    aliases: ['datenbank', 'tabelle', 'database', 'table', 'inline'],
    run: async (e, r, ctx) => {
      if (r) e.chain().focus().deleteRange(r).run();
      const id = await ctx.createDatabase?.({ inline: true });
      if (id) e.chain().focus().insertDatabase(id).run();
    },
  },
  {
    id: 'databaseFullPage',
    icon: Sheet,
    aliases: ['datenbank ganzseitig', 'full page database', 'datenbankseite'],
    run: async (e, r, ctx) => {
      if (r) e.chain().focus().deleteRange(r).run();
      const id = await ctx.createDatabase?.({ inline: false });
      if (id) e.chain().focus().insertSubpage(id).run();
    },
  },
  {
    id: 'databaseLinked',
    icon: Database,
    aliases: ['verknüpfte datenbank', 'linked database', 'linked view', 'ansicht einer datenbank'],
    run: async (e, r, ctx) => {
      if (r) e.chain().focus().deleteRange(r).run();
      const source = await ctx.pickPage();
      if (!source) return;
      const id = await ctx.createDatabase?.({ inline: true, sourceDatabaseId: source });
      if (id) e.chain().focus().insertDatabase(id).run();
    },
  },
];

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function filterCommands(query: string, label: (id: string) => string): BlockCommand[] {
  const q = normalize(query.trim());
  if (!q) return BLOCK_COMMANDS;
  return BLOCK_COMMANDS.filter((c) =>
    [label(c.id), ...c.aliases].some((a) => normalize(a).includes(q)),
  );
}
