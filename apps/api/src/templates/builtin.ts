import type { PmNode } from '@jotion/editor/projection';
import type { CreatablePropertyType, OptionColor, StatusGroup } from '@jotion/shared';

/**
 * Phase 9: Mitgelieferte Vorlagen als Baupläne. Inhalt im ProseMirror-JSON-Format, Datenbanken
 * mit Properties, Ansichten und Beispielzeilen. Texte je Sprache (de, en).
 */

export type Lang = 'de' | 'en';
type T = { de: string; en: string };

export interface PropBlueprint {
  ref: string;
  name: T;
  type: CreatablePropertyType;
  options?: { name: T; color: OptionColor; group?: StatusGroup }[];
  config?: Record<string, unknown>;
}
export interface ViewBlueprint {
  name: T;
  type: 'table' | 'board' | 'list' | 'gallery' | 'calendar' | 'timeline';
  groupBy?: string;
  date?: string;
  sorts?: { ref: string; direction: 'asc' | 'desc' }[];
}
/** Werte: Optionsname (T oder Text), Datum als { days } relativ zu heute, Wahrheitswert, Zahl, Text */
export type RowValue = T | string | number | boolean | { days: number; endDays?: number } | null;
export interface RowBlueprint {
  title: T;
  values?: Record<string, RowValue>;
}
export interface DbBlueprint {
  ref: string;
  title: T;
  icon?: string;
  /** Name der Titel-Spalte */
  titleName?: T;
  properties: PropBlueprint[];
  views: ViewBlueprint[];
  rows: RowBlueprint[];
}
export interface PageBlueprint {
  title: T;
  icon: string;
  content: (lang: Lang) => PmNode[];
}
export interface Blueprint {
  key: string;
  icon: string;
  title: T;
  description: T;
  category: 'productivity' | 'school' | 'knowledge';
  databases: DbBlueprint[];
  /** Unterseiten (erscheinen als Unterseiten-Blöcke am Ende) */
  pages?: PageBlueprint[];
  content: (lang: Lang) => PmNode[];
}

const t = (de: string, en: string): T => ({ de, en });
const text = (s: string, marks?: string[]): PmNode => ({
  type: 'text',
  text: s,
  ...(marks?.length ? { marks: marks.map((m) => ({ type: m })) } : {}),
});
const h = (level: 1 | 2 | 3, s: string): PmNode => ({
  type: 'heading',
  attrs: { level },
  content: [text(s)],
});
const p = (...parts: (string | PmNode)[]): PmNode => ({
  type: 'paragraph',
  content: parts.filter((x) => x !== '').map((x) => (typeof x === 'string' ? text(x) : x)),
});
const callout = (icon: string, s: string): PmNode => ({
  type: 'callout',
  attrs: { icon },
  content: [p(s)],
});
const todos = (items: string[]): PmNode => ({
  type: 'taskList',
  content: items.map((s) => ({ type: 'taskItem', attrs: { checked: false }, content: [p(s)] })),
});
const bullets = (items: string[]): PmNode => ({
  type: 'bulletList',
  content: items.map((s) => ({ type: 'listItem', content: [p(s)] })),
});
const hr = (): PmNode => ({ type: 'horizontalRule' });
/** Platzhalter für eine Datenbank des Bauplans (wird beim Anlegen durch die ID ersetzt) */
export const dbBlock = (ref: string): PmNode => ({
  type: 'database',
  attrs: { databaseId: `db:${ref}` },
});
const meta = (lang: Lang) =>
  p(
    text(lang === 'de' ? 'Angelegt am @heute von @ersteller' : 'Created on @today by @creator', [
      'italic',
    ]),
  );

const STATUS = [
  { name: t('Offen', 'To do'), color: 'gray' as const, group: 'todo' as const },
  { name: t('In Arbeit', 'In progress'), color: 'blue' as const, group: 'in_progress' as const },
  { name: t('Erledigt', 'Done'), color: 'green' as const, group: 'complete' as const },
];
const PRIORITY = [
  { name: t('Hoch', 'High'), color: 'red' as const },
  { name: t('Mittel', 'Medium'), color: 'yellow' as const },
  { name: t('Niedrig', 'Low'), color: 'gray' as const },
];
const SUBJECTS = [
  { name: t('Mathe', 'Maths'), color: 'blue' as const },
  { name: t('Deutsch', 'German'), color: 'red' as const },
  { name: t('Englisch', 'English'), color: 'purple' as const },
  { name: t('Bio', 'Biology'), color: 'green' as const },
  { name: t('Sport', 'PE'), color: 'orange' as const },
];
const DAYS = [
  t('Montag', 'Monday'),
  t('Dienstag', 'Tuesday'),
  t('Mittwoch', 'Wednesday'),
  t('Donnerstag', 'Thursday'),
  t('Freitag', 'Friday'),
];

export const BLUEPRINTS: Blueprint[] = [
  {
    key: 'tasks',
    icon: '✅',
    category: 'productivity',
    title: t('Aufgaben', 'Tasks'),
    description: t(
      'Aufgaben mit Status, Fälligkeit und Priorität; Board und Kalender',
      'Tasks with status, due date and priority; board and calendar',
    ),
    databases: [
      {
        ref: 'tasks',
        title: t('Aufgaben', 'Tasks'),
        titleName: t('Aufgabe', 'Task'),
        properties: [
          { ref: 'status', name: t('Status', 'Status'), type: 'status', options: STATUS },
          { ref: 'due', name: t('Fällig', 'Due'), type: 'date' },
          { ref: 'prio', name: t('Priorität', 'Priority'), type: 'select', options: PRIORITY },
          { ref: 'done', name: t('Erledigt am', 'Completed on'), type: 'date' },
        ],
        views: [
          { name: t('Board', 'Board'), type: 'board', groupBy: 'status' },
          { name: t('Alle', 'All'), type: 'table', sorts: [{ ref: 'due', direction: 'asc' }] },
          { name: t('Kalender', 'Calendar'), type: 'calendar', date: 'due' },
        ],
        rows: [
          {
            title: t('Wochenplanung', 'Weekly planning'),
            values: { status: STATUS[1]!.name, due: { days: 1 }, prio: PRIORITY[0]!.name },
          },
          {
            title: t('Einkaufsliste schreiben', 'Write shopping list'),
            values: { status: STATUS[0]!.name, due: { days: 2 }, prio: PRIORITY[1]!.name },
          },
          {
            title: t('Jotion ausprobieren', 'Try Jotion'),
            values: { status: STATUS[2]!.name, due: { days: 0 }, done: { days: 0 } },
          },
        ],
      },
    ],
    content: (l) => [
      callout(
        '💡',
        l === 'de'
          ? 'Ziehe Karten im Board in eine andere Spalte, um den Status zu ändern.'
          : 'Drag cards to another column to change their status.',
      ),
      dbBlock('tasks'),
      meta(l),
    ],
  },
  {
    key: 'timetable',
    icon: '🗓️',
    category: 'school',
    title: t('Stundenplan', 'Timetable'),
    description: t(
      'Stunden je Wochentag mit Fach, Raum und Lehrkraft',
      'Lessons per weekday with subject, room and teacher',
    ),
    databases: [
      {
        ref: 'lessons',
        title: t('Stunden', 'Lessons'),
        titleName: t('Stunde', 'Lesson'),
        properties: [
          {
            ref: 'day',
            name: t('Tag', 'Day'),
            type: 'select',
            options: DAYS.map((d) => ({ name: d, color: 'default' as const })),
          },
          { ref: 'period', name: t('Stunde', 'Period'), type: 'number' },
          { ref: 'subject', name: t('Fach', 'Subject'), type: 'select', options: SUBJECTS },
          { ref: 'room', name: t('Raum', 'Room'), type: 'text' },
          { ref: 'teacher', name: t('Lehrkraft', 'Teacher'), type: 'text' },
        ],
        views: [
          {
            name: t('Woche', 'Week'),
            type: 'board',
            groupBy: 'day',
            sorts: [{ ref: 'period', direction: 'asc' }],
          },
          {
            name: t('Tabelle', 'Table'),
            type: 'table',
            sorts: [
              { ref: 'day', direction: 'asc' },
              { ref: 'period', direction: 'asc' },
            ],
          },
        ],
        rows: [
          {
            title: t('1. Stunde', 'Period 1'),
            values: { day: DAYS[0]!, period: 1, subject: SUBJECTS[0]!.name, room: '204' },
          },
          {
            title: t('2. Stunde', 'Period 2'),
            values: { day: DAYS[0]!, period: 2, subject: SUBJECTS[1]!.name, room: '204' },
          },
          {
            title: t('1. Stunde', 'Period 1'),
            values: { day: DAYS[1]!, period: 1, subject: SUBJECTS[2]!.name, room: '112' },
          },
          {
            title: t('3. Stunde', 'Period 3'),
            values: {
              day: DAYS[2]!,
              period: 3,
              subject: SUBJECTS[4]!.name,
              room: t('Halle', 'Gym'),
            },
          },
        ],
      },
    ],
    content: (l) => [
      p(
        l === 'de'
          ? 'Jede Karte ist eine Stunde. Fächer haben Farben, damit der Plan auf einen Blick lesbar ist.'
          : 'Each card is a lesson. Subjects have colours so the plan is easy to read.',
      ),
      dbBlock('lessons'),
      meta(l),
    ],
  },
  {
    key: 'homework',
    icon: '📚',
    category: 'school',
    title: t('Hausaufgaben-Tracker', 'Homework tracker'),
    description: t(
      'Hausaufgaben, Tests und Referate nach Fach und Fälligkeit',
      'Homework, tests and presentations by subject and due date',
    ),
    databases: [
      {
        ref: 'homework',
        title: t('Hausaufgaben', 'Homework'),
        titleName: t('Aufgabe', 'Assignment'),
        properties: [
          { ref: 'subject', name: t('Fach', 'Subject'), type: 'select', options: SUBJECTS },
          { ref: 'due', name: t('Fällig', 'Due'), type: 'date' },
          {
            ref: 'kind',
            name: t('Art', 'Type'),
            type: 'select',
            options: [
              { name: t('Hausaufgabe', 'Homework'), color: 'blue' },
              { name: t('Test', 'Test'), color: 'red' },
              { name: t('Referat', 'Presentation'), color: 'purple' },
            ],
          },
          { ref: 'done', name: t('Erledigt', 'Done'), type: 'checkbox' },
        ],
        views: [
          { name: t('Nach Fach', 'By subject'), type: 'board', groupBy: 'subject' },
          { name: t('Kalender', 'Calendar'), type: 'calendar', date: 'due' },
          { name: t('Alle', 'All'), type: 'table', sorts: [{ ref: 'due', direction: 'asc' }] },
        ],
        rows: [
          {
            title: t('Seite 42, Nr. 3', 'Page 42, no. 3'),
            values: {
              subject: SUBJECTS[0]!.name,
              due: { days: 1 },
              kind: t('Hausaufgabe', 'Homework'),
            },
          },
          {
            title: t('Vokabeltest Unit 4', 'Vocabulary test unit 4'),
            values: { subject: SUBJECTS[2]!.name, due: { days: 4 }, kind: t('Test', 'Test') },
          },
          {
            title: t('Referat Zellen', 'Presentation on cells'),
            values: {
              subject: SUBJECTS[3]!.name,
              due: { days: 10 },
              kind: t('Referat', 'Presentation'),
            },
          },
        ],
      },
    ],
    content: (l) => [
      callout(
        '🎯',
        l === 'de'
          ? 'Hake "Erledigt" ab, sobald du fertig bist. Der Kalender zeigt, was als Nächstes ansteht.'
          : 'Tick "Done" when finished. The calendar shows what is coming up.',
      ),
      dbBlock('homework'),
      meta(l),
    ],
  },
  {
    key: 'roadmap',
    icon: '🗺️',
    category: 'productivity',
    title: t('Projekt-Roadmap', 'Project roadmap'),
    description: t(
      'Meilensteine mit Zeitraum, Status und Verantwortlichen auf einer Zeitleiste',
      'Milestones with timeframe, status and owner on a timeline',
    ),
    databases: [
      {
        ref: 'milestones',
        title: t('Meilensteine', 'Milestones'),
        titleName: t('Meilenstein', 'Milestone'),
        properties: [
          { ref: 'status', name: t('Status', 'Status'), type: 'status', options: STATUS },
          { ref: 'when', name: t('Zeitraum', 'Timeframe'), type: 'date' },
          { ref: 'owner', name: t('Verantwortlich', 'Owner'), type: 'person' },
          {
            ref: 'area',
            name: t('Bereich', 'Area'),
            type: 'select',
            options: [
              { name: t('Planung', 'Planning'), color: 'yellow' },
              { name: t('Umsetzung', 'Build'), color: 'blue' },
              { name: t('Start', 'Launch'), color: 'green' },
            ],
          },
        ],
        views: [
          { name: t('Zeitleiste', 'Timeline'), type: 'timeline', date: 'when' },
          { name: t('Status', 'Status'), type: 'board', groupBy: 'status' },
          { name: t('Tabelle', 'Table'), type: 'table' },
        ],
        rows: [
          {
            title: t('Ziele festlegen', 'Define goals'),
            values: {
              status: STATUS[2]!.name,
              when: { days: -7, endDays: -2 },
              area: t('Planung', 'Planning'),
            },
          },
          {
            title: t('Erste Version', 'First version'),
            values: {
              status: STATUS[1]!.name,
              when: { days: -1, endDays: 13 },
              area: t('Umsetzung', 'Build'),
            },
          },
          {
            title: t('Veröffentlichung', 'Release'),
            values: {
              status: STATUS[0]!.name,
              when: { days: 14, endDays: 16 },
              area: t('Start', 'Launch'),
            },
          },
        ],
      },
    ],
    content: (l) => [
      h(2, l === 'de' ? 'Ziel' : 'Goal'),
      p(
        l === 'de'
          ? 'Beschreibe hier in zwei Sätzen, was das Projekt erreichen soll.'
          : 'Describe in two sentences what this project should achieve.',
      ),
      h(2, l === 'de' ? 'Meilensteine' : 'Milestones'),
      dbBlock('milestones'),
      h(2, l === 'de' ? 'Offene Fragen' : 'Open questions'),
      todos([l === 'de' ? 'Wer gibt den Start frei?' : 'Who approves the launch?']),
      meta(l),
    ],
  },
  {
    key: 'notes',
    icon: '📝',
    category: 'knowledge',
    title: t('Notizen', 'Notes'),
    description: t(
      'Notizen mit Kategorien als Galerie und Tabelle',
      'Notes with categories as gallery and table',
    ),
    databases: [
      {
        ref: 'notes',
        title: t('Notizen', 'Notes'),
        titleName: t('Titel', 'Title'),
        properties: [
          {
            ref: 'tags',
            name: t('Kategorien', 'Categories'),
            type: 'multi_select',
            options: [
              { name: t('Idee', 'Idea'), color: 'yellow' },
              { name: t('Besprechung', 'Meeting'), color: 'blue' },
              { name: t('Lernen', 'Learning'), color: 'green' },
            ],
          },
          { ref: 'created', name: t('Erstellt', 'Created'), type: 'created_time' },
        ],
        views: [
          { name: t('Galerie', 'Gallery'), type: 'gallery' },
          {
            name: t('Liste', 'List'),
            type: 'table',
            sorts: [{ ref: 'created', direction: 'desc' }],
          },
        ],
        rows: [
          {
            title: t('Ideen für das Wochenende', 'Weekend ideas'),
            values: { tags: t('Idee', 'Idea') },
          },
          {
            title: t('Besprechung Montag', 'Monday meeting'),
            values: { tags: t('Besprechung', 'Meeting') },
          },
        ],
      },
    ],
    content: (l) => [dbBlock('notes'), meta(l)],
  },
  {
    key: 'wiki',
    icon: '📖',
    category: 'knowledge',
    title: t('Wiki', 'Wiki'),
    description: t(
      'Wissenssammlung mit Inhaltsverzeichnis und Unterseiten',
      'Knowledge base with table of contents and sub pages',
    ),
    databases: [],
    pages: [
      {
        title: t('Erste Schritte', 'Getting started'),
        icon: '🚀',
        content: (l) => [
          h(2, l === 'de' ? 'Willkommen' : 'Welcome'),
          p(
            l === 'de'
              ? 'Hier steht, was neue Mitglieder zuerst wissen müssen.'
              : 'What new members should know first.',
          ),
          todos(
            l === 'de'
              ? ['Profil ausfüllen', 'Wichtige Seiten als Favorit markieren']
              : ['Fill in your profile', 'Favourite important pages'],
          ),
        ],
      },
      {
        title: t('Regeln und Abläufe', 'Rules and processes'),
        icon: '📋',
        content: (l) => [
          h(2, l === 'de' ? 'So arbeiten wir' : 'How we work'),
          bullets(
            l === 'de'
              ? [
                  'Entscheidungen werden schriftlich festgehalten.',
                  'Fragen gehören in die Kommentare.',
                ]
              : ['Decisions are written down.', 'Questions go into comments.'],
          ),
        ],
      },
    ],
    content: (l) => [
      { type: 'tableOfContents' },
      h(2, l === 'de' ? 'Über dieses Wiki' : 'About this wiki'),
      p(
        l === 'de'
          ? 'Sammle hier Wissen, das alle brauchen. Jede Unterseite ist ein Thema.'
          : 'Collect knowledge everyone needs here. Each sub page is one topic.',
      ),
      hr(),
      h(2, l === 'de' ? 'Themen' : 'Topics'),
      meta(l),
    ],
  },
];

export function blueprint(key: string): Blueprint | undefined {
  return BLUEPRINTS.find((b) => b.key === key);
}
