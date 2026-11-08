import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import { describe, expect, it } from 'vitest';
import { BlockRangeSelection, blockRangeBetween, blockRangeByIndex } from './block-selection';
import { BLOCK_NODE_TYPES, DOC_FRAGMENT } from './constants';
import { resolveEmbed } from './embeds';
import { jotionExtensions } from './extensions';
import { collectHeadings, normalizeColumnWidths, resizeColumns } from './nodes/layout';
import {
  appendPmContent,
  docToJson,
  projectDoc,
  remapDocIds,
  remapSubpages,
  replaceTextVariables,
  subpageIds,
} from './projection';
import * as Y from 'yjs';
import { safeMediaSrc } from './urls';

const schema = getSchema(jotionExtensions({ collaborative: true }));
const FILE = '01900000-0000-7000-8000-0000000000f1';
const USER = '01900000-0000-7000-8000-0000000000a1';
const PAGE = '01900000-0000-7000-8000-0000000000b1';
const CHILD = '01900000-0000-7000-8000-0000000000c1';

const p = (id: string, text: string) => ({
  type: 'paragraph',
  attrs: { id },
  content: [{ type: 'text', text }],
});

/** Dokument mit allen Phase-3-Blöcken */
const sample = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { id: 'h1', level: 1 }, content: [{ type: 'text', text: 'Start' }] },
    {
      type: 'image',
      attrs: {
        id: 'img',
        src: `/api/files/${FILE}`,
        width: 60,
        align: 'left',
        caption: 'Sonnenuntergang',
      },
    },
    {
      type: 'video',
      attrs: { id: 'vid', src: 'https://example.com/a.mp4', name: 'a.mp4', caption: '' },
    },
    { type: 'audio', attrs: { id: 'aud', src: `/api/files/${FILE}`, name: 'ton.mp3' } },
    {
      type: 'file',
      attrs: { id: 'fil', src: `/api/files/${FILE}`, name: 'bericht.zip', size: 42 },
    },
    { type: 'pdf', attrs: { id: 'pdf', src: `/api/files/${FILE}`, name: 'handbuch.pdf' } },
    {
      type: 'bookmark',
      attrs: {
        id: 'bm',
        url: 'https://example.com/',
        title: 'Beispielseite',
        description: 'Eine Beschreibung',
      },
    },
    { type: 'embed', attrs: { id: 'em', url: 'https://youtu.be/dQw4w9WgXcQ', caption: 'Video' } },
    {
      type: 'table',
      attrs: { id: 'tab' },
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [p('th1', 'Name')] },
            { type: 'tableHeader', content: [p('th2', 'Wert')] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [p('td1', 'Alpha')] },
            { type: 'tableCell', content: [p('td2', '42')] },
          ],
        },
      ],
    },
    {
      type: 'columnList',
      attrs: { id: 'cols' },
      content: [
        { type: 'column', attrs: { id: 'col1', width: 0.3 }, content: [p('cp1', 'Links')] },
        { type: 'column', attrs: { id: 'col2', width: 0.7 }, content: [p('cp2', 'Rechts')] },
      ],
    },
    { type: 'tableOfContents', attrs: { id: 'toc' } },
    { type: 'breadcrumb', attrs: { id: 'bc' } },
    { type: 'mathBlock', attrs: { id: 'mb', latex: 'E = mc^2' } },
    {
      type: 'paragraph',
      attrs: { id: 'pm' },
      content: [
        { type: 'text', text: 'Hallo ' },
        { type: 'mention', attrs: { kind: 'user', targetId: USER, label: 'Max' } },
        { type: 'text', text: ' siehe ' },
        { type: 'mention', attrs: { kind: 'page', targetId: PAGE } },
        { type: 'text', text: ' am ' },
        { type: 'mention', attrs: { kind: 'date', date: '2026-11-04' } },
        { type: 'text', text: ' mit ' },
        { type: 'mathInline', attrs: { latex: 'a^2' } },
      ],
    },
    { type: 'subpage', attrs: { id: 'sp', pageId: CHILD } },
  ],
};

const toYDoc = () => prosemirrorJSONToYDoc(schema, sample, DOC_FRAGMENT);

describe('Schema Phase 3', () => {
  it('akzeptiert alle neuen Blocktypen und bleibt über Yjs verlustfrei', () => {
    const node = PMNode.fromJSON(schema, sample);
    expect(() => node.check()).not.toThrow();
    const roundtrip = PMNode.fromJSON(schema, yDocToProsemirrorJSON(toYDoc(), DOC_FRAGMENT));
    expect(roundtrip.eq(node)).toBe(true);
  });

  it('jeder Blocktyp mit ID existiert im Schema', () => {
    for (const t of BLOCK_NODE_TYPES) expect(schema.nodes[t], t).toBeDefined();
  });

  it('erlaubt nur 2 bis 5 Spalten', () => {
    const cols = (n: number) => ({
      type: 'doc',
      content: [
        {
          type: 'columnList',
          content: Array.from({ length: n }, () => ({
            type: 'column',
            content: [{ type: 'paragraph' }],
          })),
        },
      ],
    });
    expect(() => PMNode.fromJSON(schema, cols(1)).check()).toThrow();
    expect(() => PMNode.fromJSON(schema, cols(5)).check()).not.toThrow();
    expect(() => PMNode.fromJSON(schema, cols(6)).check()).toThrow();
  });
});

describe('Projektion Phase 3', () => {
  const projection = projectDoc(toYDoc());
  const byId = Object.fromEntries(projection.blocks.map((b) => [b.id, b]));

  it('erfasst jeden Block mit ID genau einmal, mit Text und Eigenschaften', () => {
    const ids = projection.blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(byId.img).toMatchObject({
      type: 'image',
      text: 'Sonnenuntergang',
      props: { src: `/api/files/${FILE}`, width: 60, align: 'left', caption: 'Sonnenuntergang' },
    });
    expect(byId.fil!.text).toContain('bericht.zip');
    expect(byId.bm!.text).toContain('Beispielseite');
    expect(byId.bm!.props).toMatchObject({ url: 'https://example.com/', title: 'Beispielseite' });
    expect(byId.mb).toMatchObject({ type: 'mathBlock', text: 'E = mc^2' });
    expect(byId.toc!.type).toBe('tableOfContents');
    expect(byId.bc!.type).toBe('breadcrumb');
  });

  it('bildet Tabellen und Spalten hierarchisch ab', () => {
    expect(byId.td2).toMatchObject({ parentId: 'tab', text: '42' });
    expect(byId.col2).toMatchObject({ parentId: 'cols', props: { width: 0.7 } });
    expect(byId.cp2!.parentId).toBe('col2');
  });

  it('nimmt Erwähnungen und Inline-Formeln in den Text auf, ohne Seitentitel', () => {
    expect(byId.pm!.text).toBe('Hallo @Max siehe  am @2026-11-04 mit a^2');
  });

  it('liefert Verweise auf Personen, Seiten, Dateien und Unterseiten', () => {
    const refs = projection.references.map((r) => `${r.blockId}:${r.targetType}:${r.targetId}`);
    expect(refs).toEqual(
      expect.arrayContaining([
        `img:file:${FILE}`,
        `aud:file:${FILE}`,
        `pm:user:${USER}`,
        `pm:page:${PAGE}`,
        `sp:page:${CHILD}`,
      ]),
    );
    // Externe Quellen und Daten erzeugen keine Verweise
    expect(refs.some((r) => r.startsWith('vid:'))).toBe(false);
    expect(refs.filter((r) => r.startsWith('pm:'))).toHaveLength(2);
  });

  it('ignoriert ungültige IDs in Erwähnungen', () => {
    const doc = prosemirrorJSONToYDoc(
      schema,
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { id: 'x' },
            content: [{ type: 'mention', attrs: { kind: 'page', targetId: "1'; DROP" } }],
          },
        ],
      },
      DOC_FRAGMENT,
    );
    expect(projectDoc(doc).references).toEqual([]);
  });
});

describe('docToJson', () => {
  it('entspricht y-prosemirror', () => {
    const doc = toYDoc();
    expect(docToJson(doc)).toEqual(yDocToProsemirrorJSON(doc, DOC_FRAGMENT));
  });

  it('behält Marken mit Attributen', () => {
    const doc = prosemirrorJSONToYDoc(
      schema,
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { id: 'p' },
            content: [
              {
                type: 'text',
                text: 'Link',
                marks: [{ type: 'link', attrs: { href: 'https://example.com' } }, { type: 'bold' }],
              },
            ],
          },
        ],
      },
      DOC_FRAGMENT,
    );
    const json = docToJson(doc);
    expect(() => PMNode.fromJSON(schema, json).check()).not.toThrow();
    expect(PMNode.fromJSON(schema, json).textContent).toBe('Link');
  });
});

describe('remapSubpages', () => {
  it('setzt Unterseiten um und entfernt nicht kopierte', () => {
    const doc = toYDoc();
    const NEW = '01900000-0000-7000-8000-0000000000c2';
    remapSubpages(doc, new Map([[CHILD, NEW]]));
    expect(subpageIds(doc)).toEqual([NEW]);
    remapSubpages(doc, new Map());
    expect(subpageIds(doc)).toEqual([]);
  });
});

describe('Vorlagen (Phase 9)', () => {
  let n = 0;
  const id = () => `b${++n}`;

  it('baut Inhalt aus JSON passend zum Schema, mit Block-IDs und Marks', () => {
    const doc = new Y.Doc();
    appendPmContent(
      doc,
      [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Woche' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Fett', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' und normal' },
          ],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Aufgabe' }] }],
            },
          ],
        },
        {
          type: 'callout',
          attrs: { icon: '📌' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hinweis' }] }],
        },
        { type: 'database', attrs: { databaseId: PAGE } },
      ],
      id,
    );
    const json = yDocToProsemirrorJSON(doc, DOC_FRAGMENT);
    const node = PMNode.fromJSON(schema, json);
    expect(() => node.check()).not.toThrow();
    expect(node.textContent).toContain('Fett und normal');
    expect(
      node
        .child(1)
        .child(0)
        .marks.map((m) => m.type.name),
    ).toEqual(['bold']);
    // Jeder Block hat eine ID (für Projektion und Verweise)
    expect(projectDoc(doc).blocks.every((b) => b.id)).toBe(true);
    expect(projectDoc(doc).blocks.map((b) => b.type)).toContain('database');
  });

  it('schreibt Verweise auf Kopien um und entfernt fremde Unterseiten und Datenbanken', () => {
    const doc = new Y.Doc();
    const OTHER = '01900000-0000-7000-8000-0000000000d1';
    const NEW = '01900000-0000-7000-8000-0000000000d2';
    appendPmContent(
      doc,
      [
        { type: 'subpage', attrs: { pageId: CHILD } },
        { type: 'subpage', attrs: { pageId: OTHER } },
        { type: 'database', attrs: { databaseId: OTHER } },
        { type: 'pageLink', attrs: { pageId: OTHER } },
      ],
      id,
    );
    remapDocIds(doc, new Map([[CHILD, NEW]]));
    const json = yDocToProsemirrorJSON(doc, DOC_FRAGMENT) as {
      content: { type: string; attrs: Record<string, string> }[];
    };
    expect(json.content.map((c) => [c.type, c.attrs.pageId ?? c.attrs.databaseId])).toEqual([
      ['subpage', NEW],
      ['pageLink', OTHER],
    ]);
  });

  it('ersetzt Variablen und behält Formatierung', () => {
    const doc = new Y.Doc();
    appendPmContent(
      doc,
      [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Stand @heute', marks: [{ type: 'italic' }] },
            { type: 'text', text: ' von @ersteller (@heute)' },
          ],
        },
      ],
      id,
    );
    expect(replaceTextVariables(doc, { '@heute': '8.11.2026', '@ersteller': 'Jarne' })).toBe(3);
    const node = PMNode.fromJSON(schema, yDocToProsemirrorJSON(doc, DOC_FRAGMENT));
    expect(node.textContent).toBe('Stand 8.11.2026 von Jarne (8.11.2026)');
    expect(
      node
        .child(0)
        .child(0)
        .marks.map((m) => m.type.name),
    ).toEqual(['italic']);
  });
});

describe('Embeds (Whitelist)', () => {
  it.each([
    [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'youtube',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    ],
    [
      'https://youtu.be/dQw4w9WgXcQ?t=42',
      'youtube',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42',
    ],
    ['https://vimeo.com/123456789', 'vimeo', 'https://player.vimeo.com/video/123456789'],
    [
      'https://www.figma.com/design/AbC123/Entwurf',
      'figma',
      'https://www.figma.com/embed?embed_host=jotion&url=https%3A%2F%2Fwww.figma.com%2Fdesign%2FAbC123%2FEntwurf',
    ],
    [
      'https://www.google.com/maps/place/Berlin',
      'googleMaps',
      'https://maps.google.com/maps?q=Berlin&output=embed',
    ],
    [
      'https://www.loom.com/share/0123456789abcdef0123',
      'loom',
      'https://www.loom.com/embed/0123456789abcdef0123',
    ],
    [
      'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
      'spotify',
      'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC',
    ],
  ])('%s', (url, provider, src) => {
    expect(resolveEmbed(url)).toMatchObject({ provider, src });
  });

  it.each([
    'https://evil.example/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.example/watch?v=x',
    'javascript:alert(1)',
    'https://www.youtube.com/watch?v=<script>',
    'https://user:pw@www.youtube.com/watch?v=dQw4w9WgXcQ',
    'data:text/html,hi',
    '',
    null,
  ])('lehnt %s ab', (url) => {
    expect(resolveEmbed(url)).toBeNull();
  });
});

describe('Medienquellen', () => {
  it('erlaubt eigene Dateien und http(s), sonst nichts', () => {
    expect(safeMediaSrc(`/api/files/${FILE}`)).toBe(`/api/files/${FILE}`);
    expect(safeMediaSrc('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(safeMediaSrc('javascript:alert(1)')).toBeNull();
    expect(safeMediaSrc('data:image/png;base64,AAAA')).toBeNull();
    expect(safeMediaSrc('/api/files/../auth/me')).toBeNull();
    expect(safeMediaSrc('//evil.example/x.png')).toBeNull();
  });
});

describe('Spaltenbreiten', () => {
  it('normiert und verteilt fehlende Breiten', () => {
    expect(normalizeColumnWidths([null, null])).toEqual([0.5, 0.5]);
    const w = normalizeColumnWidths([0.5, null, null]);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it('verschiebt nur die beiden benachbarten Spalten, mit Mindestbreite', () => {
    const w = resizeColumns([0.5, 0.5], 0, 0.2);
    expect(w[0]).toBeCloseTo(0.7);
    expect(w[1]).toBeCloseTo(0.3);
    const clamped = resizeColumns([0.5, 0.5], 0, 0.9);
    expect(clamped[1]).toBeCloseTo(0.1);
    const three = resizeColumns([1 / 3, 1 / 3, 1 / 3], 1, -0.1);
    expect(three[0]).toBeCloseTo(1 / 3);
    expect(three[1]! + three[2]!).toBeCloseTo(2 / 3);
  });
});

describe('Inhaltsverzeichnis', () => {
  it('sammelt Überschriften auch in Spalten', () => {
    const doc = PMNode.fromJSON(schema, {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { id: 'a', level: 1 },
          content: [{ type: 'text', text: 'Eins' }],
        },
        {
          type: 'columnList',
          content: [
            {
              type: 'column',
              content: [
                {
                  type: 'heading',
                  attrs: { id: 'b', level: 2 },
                  content: [{ type: 'text', text: 'Zwei' }],
                },
              ],
            },
            { type: 'column', content: [{ type: 'paragraph' }] },
          ],
        },
      ],
    });
    expect(collectHeadings(doc).map((h) => [h.id, h.level, h.text])).toEqual([
      ['a', 1, 'Eins'],
      ['b', 2, 'Zwei'],
    ]);
  });
});

describe('Blockauswahl', () => {
  const doc = PMNode.fromJSON(schema, {
    type: 'doc',
    content: [p('a', 'Eins'), p('b', 'Zwei'), p('c', 'Drei'), p('d', 'Vier')],
  });

  it('umfasst ganze Blöcke und liefert sie beim Kopieren', () => {
    const sel = blockRangeByIndex(doc, 1, 2)!;
    expect(sel.blockIndices()).toEqual([1, 2]);
    expect(sel.content().content.childCount).toBe(2);
    expect(sel.content().content.firstChild!.textContent).toBe('Zwei');
  });

  it('erweitert beliebige Positionen auf Blockgrenzen', () => {
    const sel = blockRangeBetween(doc, 3, 9)!;
    expect(sel.blockIndices()).toEqual([0, 1]);
  });

  it('löscht die ausgewählten Blöcke', () => {
    const state = EditorState.create({ schema, doc });
    const tr = state.tr.setSelection(blockRangeByIndex(doc, 0, 1)!).deleteSelection();
    expect(tr.doc.childCount).toBe(2);
    expect(tr.doc.textContent).toBe('DreiVier');
  });

  it('übersteht Änderungen und JSON', () => {
    const state = EditorState.create({ schema, doc });
    const sel = blockRangeByIndex(doc, 2, 3)!;
    const tr = state.tr.setSelection(sel).insert(0, schema.nodes.paragraph!.create());
    expect(tr.selection).toBeInstanceOf(BlockRangeSelection);
    expect((tr.selection as BlockRangeSelection).blockIndices()).toEqual([3, 4]);
    const json = sel.toJSON();
    expect(BlockRangeSelection.fromJSON(doc, json).eq(sel)).toBe(true);
  });
});
