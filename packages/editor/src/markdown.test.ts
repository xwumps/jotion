import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { jotionExtensions } from './extensions';
import { markdownToPm, pmToHtml, pmToMarkdown } from './markdown';

/** Phase 12: Markdown-Import und -Export gegen das echte Schema. */
const schema = getSchema(jotionExtensions({ collaborative: true }));
const valid = (content: unknown[]) => PMNode.fromJSON(schema, { type: 'doc', content }).check();

const MD = `# Reiseplan

Abfahrt am **Samstag** um *acht*, siehe [Karte](https://example.com/karte).

## Packliste

- [x] Zelt
- [ ] Schlafsack

1. Erstens
2. Zweitens
   - verschachtelt

> Zitat mit \`Code\`

\`\`\`ts
const a = 1;
\`\`\`

| Tag | Ort |
| --- | --- |
| Sa | Hamburg |

![Strand](bilder/strand.png)

---

<script>alert(1)</script>
`;

describe('Markdown', () => {
  it('Import: Titel aus H1, alle Blöcke gültig im Schema, kein Roh-HTML', () => {
    const r = markdownToPm(MD, {
      titleFromHeading: true,
      resolveImage: (src) => (src === 'bilder/strand.png' ? '/api/files/abc' : null),
    });
    expect(r.title).toBe('Reiseplan');
    expect(() => valid(r.content)).not.toThrow();
    const types = r.content.map((n) => n.type);
    expect(types).toEqual([
      'paragraph',
      'heading',
      'taskList',
      'orderedList',
      'blockquote',
      'codeBlock',
      'table',
      'image',
      'horizontalRule',
      'paragraph',
    ]);
    expect(r.content[2]!.content!.map((i) => i.attrs?.checked)).toEqual([true, false]);
    expect(r.content[7]!.attrs).toMatchObject({ src: '/api/files/abc', caption: 'Strand' });
    const para = r.content[0]!.content!;
    expect(para.find((n) => n.text === 'Samstag')!.marks).toEqual([{ type: 'bold' }]);
    expect(para.find((n) => n.text === 'Karte')!.marks).toEqual([
      { type: 'link', attrs: { href: 'https://example.com/karte' } },
    ]);
    // Skript bleibt Text
    expect(JSON.stringify(r.content.at(-1))).toContain('<script>');
  });

  it('unsichere Links und Bilder werden verworfen', () => {
    const r = markdownToPm('[x](javascript:alert(1)) ![b](javascript:x)');
    expect(JSON.stringify(r.content)).not.toContain('javascript');
  });

  it('Export nach Markdown und zurück erhält Struktur und Formatierung', () => {
    const { content } = markdownToPm(MD, {
      titleFromHeading: true,
      resolveImage: () => 'bild.png',
    });
    const md = pmToMarkdown('Reiseplan', content);
    expect(md).toContain('# Reiseplan');
    expect(md).toContain('- [x] Zelt');
    expect(md).toContain('**Samstag**');
    expect(md).toContain('| Sa | Hamburg |');
    expect(md).toContain('![Strand](bild.png)');
    const again = markdownToPm(md, { titleFromHeading: true, resolveImage: (s) => s });
    expect(again.title).toBe('Reiseplan');
    expect(again.content.map((n) => n.type)).toEqual(content.map((n) => n.type));
  });

  it('HTML-Export maskiert Inhalte', () => {
    const html = pmToHtml('<Titel>', [
      { type: 'paragraph', content: [{ type: 'text', text: '<b>fett</b>' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:1' } }] },
        ],
      },
    ]);
    expect(html).toContain('&lt;Titel&gt;');
    expect(html).toContain('&lt;b&gt;fett&lt;/b&gt;');
    expect(html).not.toContain('javascript');
  });
});
