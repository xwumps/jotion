import type { Editor, Range } from '@tiptap/core';
import {
  CheckSquare,
  ChevronRight,
  Code,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Link2,
  List,
  ListOrdered,
  Lightbulb,
  Minus,
  Quote,
  Type,
  type LucideIcon,
} from 'lucide-react';

export interface CommandContext {
  createSubpage: () => Promise<string | null>;
  pickPage: () => Promise<string | null>;
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
];

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function filterCommands(query: string, label: (id: string) => string): BlockCommand[] {
  const q = normalize(query.trim());
  if (!q) return BLOCK_COMMANDS;
  return BLOCK_COMMANDS.filter((c) =>
    [label(c.id), ...c.aliases].some((a) => normalize(a).includes(q)),
  );
}
