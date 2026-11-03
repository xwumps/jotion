import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DOC_FRAGMENT } from './constants';
import { jotionExtensions } from './extensions';
import { appendSubpageBlock, projectDoc, removeSubpageBlocks, subpageIds } from './projection';

const schema = getSchema(jotionExtensions({ collaborative: true }));
const PAGE_A = '01900000-0000-7000-8000-00000000000a';
const PAGE_B = '01900000-0000-7000-8000-00000000000b';

const sample = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { id: 'h1', level: 1 }, content: [{ type: 'text', text: 'Titel' }] },
    {
      type: 'paragraph',
      attrs: { id: 'p1', blockColor: 'red_background' },
      content: [
        { type: 'text', text: 'Hallo ' },
        { type: 'text', text: 'Welt', marks: [{ type: 'bold' }] },
      ],
    },
    {
      type: 'bulletList',
      attrs: { id: 'ul' },
      content: [
        {
          type: 'listItem',
          attrs: { id: 'li1' },
          content: [
            { type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'text', text: 'Punkt' }] },
          ],
        },
      ],
    },
    {
      type: 'taskList',
      attrs: { id: 'tl' },
      content: [
        {
          type: 'taskItem',
          attrs: { id: 'ti', checked: true },
          content: [
            {
              type: 'paragraph',
              attrs: { id: 'p3' },
              content: [{ type: 'text', text: 'Erledigt' }],
            },
          ],
        },
      ],
    },
    {
      type: 'callout',
      attrs: { id: 'c1', icon: '⚠️' },
      content: [
        { type: 'paragraph', attrs: { id: 'p4' }, content: [{ type: 'text', text: 'Achtung' }] },
      ],
    },
    { type: 'subpage', attrs: { id: 's1', pageId: PAGE_A } },
    { type: 'pageLink', attrs: { id: 'l1', pageId: PAGE_B } },
    {
      type: 'codeBlock',
      attrs: { id: 'code', language: 'ts' },
      content: [{ type: 'text', text: 'const x = 1;' }],
    },
    { type: 'horizontalRule', attrs: { id: 'hr' } },
  ],
};

const toYDoc = () => prosemirrorJSONToYDoc(schema, sample, DOC_FRAGMENT);

describe('Schema', () => {
  it('akzeptiert alle Jotion-Blocktypen', () => {
    expect(() => PMNode.fromJSON(schema, sample).check()).not.toThrow();
  });
});

describe('projectDoc', () => {
  it('liefert Blöcke mit Hierarchie, Text und Eigenschaften', () => {
    const { blocks, text } = projectDoc(toYDoc());
    const byId = Object.fromEntries(blocks.map((b) => [b.id, b]));
    expect(byId.h1).toMatchObject({
      type: 'heading',
      text: 'Titel',
      parentId: null,
      position: 0,
      props: { level: 1 },
    });
    expect(byId.p1).toMatchObject({ text: 'Hallo Welt', props: { blockColor: 'red_background' } });
    expect(byId.p2!.parentId).toBe('li1');
    expect(byId.li1!.parentId).toBe('ul');
    expect(byId.ti!.props.checked).toBe(true);
    expect(byId.c1!.props.icon).toBe('⚠️');
    expect(byId.code).toMatchObject({ text: 'const x = 1;', props: { language: 'ts' } });
    expect(text).toContain('Achtung');
  });

  it('erkennt Seitenverweise', () => {
    expect(projectDoc(toYDoc()).references).toEqual([
      { blockId: 's1', targetType: 'page', targetId: PAGE_A },
      { blockId: 'l1', targetType: 'page', targetId: PAGE_B },
    ]);
  });

  it('erfasst doppelte Block-IDs nur einmal', () => {
    const doc = prosemirrorJSONToYDoc(
      schema,
      {
        type: 'doc',
        content: [
          { type: 'paragraph', attrs: { id: 'x' } },
          { type: 'paragraph', attrs: { id: 'x' } },
        ],
      },
      DOC_FRAGMENT,
    );
    expect(projectDoc(doc).blocks).toHaveLength(1);
  });

  it('ignoriert ungültige pageIds', () => {
    const doc = prosemirrorJSONToYDoc(
      schema,
      { type: 'doc', content: [{ type: 'subpage', attrs: { id: 's', pageId: "x'; DROP" } }] },
      DOC_FRAGMENT,
    );
    expect(projectDoc(doc).references).toEqual([]);
  });
});

describe('Serverseitige Unterseiten-Blöcke', () => {
  it('fügt ein, ohne zu duplizieren, und bleibt mit dem Editor-Schema gültig', () => {
    const doc = toYDoc();
    const PAGE_C = '01900000-0000-7000-8000-00000000000c';
    expect(appendSubpageBlock(doc, PAGE_C, 'new-block')).toBe(true);
    expect(appendSubpageBlock(doc, PAGE_C, 'other')).toBe(false);
    expect(subpageIds(doc)).toEqual([PAGE_A, PAGE_C]);
    // Der Browser muss das Dokument weiterhin laden können
    const json = yDocToProsemirrorJSON(doc, DOC_FRAGMENT);
    const node = PMNode.fromJSON(schema, json);
    expect(() => node.check()).not.toThrow();
    expect(node.lastChild?.type.name).toBe('subpage');
    expect(node.lastChild?.attrs).toMatchObject({ pageId: PAGE_C, id: 'new-block' });
  });

  it('funktioniert in einem leeren Dokument', () => {
    const doc = new Y.Doc();
    appendSubpageBlock(doc, PAGE_A, 'b1');
    expect(() =>
      PMNode.fromJSON(schema, yDocToProsemirrorJSON(doc, DOC_FRAGMENT)).check(),
    ).not.toThrow();
  });

  it('entfernt Unterseiten-Blöcke auch aus verschachtelten Blöcken', () => {
    const doc = prosemirrorJSONToYDoc(
      schema,
      {
        type: 'doc',
        content: [
          { type: 'subpage', attrs: { id: 'a', pageId: PAGE_A } },
          {
            type: 'callout',
            attrs: { id: 'c' },
            content: [{ type: 'subpage', attrs: { id: 'b', pageId: PAGE_A } }],
          },
          { type: 'subpage', attrs: { id: 'x', pageId: PAGE_B } },
        ],
      },
      DOC_FRAGMENT,
    );
    expect(removeSubpageBlocks(doc, PAGE_A)).toBe(2);
    expect(subpageIds(doc)).toEqual([PAGE_B]);
  });

  it('übersteht gleichzeitige Bearbeitung (CRDT-Merge)', () => {
    const server = toYDoc();
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
    // Client tippt, Server fügt parallel eine Unterseite ein
    const clientEdit = new Y.XmlElement('paragraph');
    clientEdit.setAttribute('id', 'typed');
    client.getXmlFragment(DOC_FRAGMENT).insert(0, [clientEdit]);
    appendSubpageBlock(server, '01900000-0000-7000-8000-0000000000dd', 'srv');
    Y.applyUpdate(server, Y.encodeStateAsUpdate(client));
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
    expect(projectDoc(server).blocks.map((b) => b.id)).toEqual(
      projectDoc(client).blocks.map((b) => b.id),
    );
    expect(projectDoc(server).blocks.map((b) => b.id)).toContain('typed');
    expect(projectDoc(server).blocks.map((b) => b.id)).toContain('srv');
  });
});
