// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSchema } from '@tiptap/core';
import { DOMParser as PMDOMParser, type Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { jotionExtensions } from './extensions';
import {
  isGoogleDocsHtml,
  isWordHtml,
  looksLikeMarkdown,
  markdownToHtml,
  normalizePastedHtml,
} from './paste';

const schema = getSchema(jotionExtensions());
const fixture = (name: string) => readFileSync(join(__dirname, 'paste-fixtures', name), 'utf8');

/** Wie ProseMirror beim Einfügen: HTML in DOM, dann über das Schema parsen. */
function parse(html: string): PMNode {
  const el = document.createElement('div');
  el.innerHTML = html;
  const doc = PMDOMParser.fromSchema(schema).parse(el);
  doc.check();
  return doc;
}

const types = (doc: PMNode) => doc.content.content.map((n) => n.type.name);
const marksOf = (doc: PMNode, text: string) => {
  let found: string[] | null = null;
  doc.descendants((n) => {
    if (n.isText && n.text === text) found = n.marks.map((m) => m.type.name).sort();
  });
  return found;
};

describe('Google Docs', () => {
  const html = fixture('google-docs.html');

  it('wird erkannt', () => {
    expect(isGoogleDocsHtml(html)).toBe(true);
    expect(isWordHtml(html)).toBe(false);
  });

  it('übernimmt Überschrift, Formatierung, Liste, Tabelle und Bild', () => {
    const doc = parse(normalizePastedHtml(html));
    expect(types(doc)).toEqual(['heading', 'paragraph', 'bulletList', 'table', 'image']);
    expect(doc.child(0).textContent).toBe('Projektbericht');
    // font-weight:400 im Wrapper ist nicht fett, Spans mit 700 schon
    expect(marksOf(doc, 'Das ist ')).toEqual([]);
    expect(marksOf(doc, 'fett')).toEqual(['bold']);
    expect(marksOf(doc, 'kursiv')).toEqual(['italic']);
    expect(marksOf(doc, 'unterstrichen')).toEqual(['underline']);
    expect(doc.child(2).childCount).toBe(2);
    expect(doc.child(3).textContent).toBe('NameWertAlpha42');
    // Eingefügtes Bild als data:-URL wird zum Hochladen markiert, nie als src gespeichert
    expect(doc.child(4).attrs.src).toBeNull();
    expect(String(doc.child(4).attrs.pendingData)).toMatch(/^data:image\/png;base64,/);
  });
});

describe('Word', () => {
  const html = fixture('word.html');

  it('wird erkannt', () => expect(isWordHtml(html)).toBe(true));

  it('baut Listen mit Verschachtelung und entfernt Office-Reste', () => {
    const normalized = normalizePastedHtml(html);
    expect(normalized).not.toMatch(/o:p|mso-list|<style|StartFragment/i);
    const doc = parse(normalized);
    expect(types(doc)).toEqual(['heading', 'paragraph', 'bulletList', 'orderedList']);
    expect(doc.child(0).textContent).toBe('Besprechung');
    expect(marksOf(doc, 'Fettdruck')).toEqual(['bold']);
    expect(marksOf(doc, 'Kursiv')).toEqual(['italic']);
    const bullets = doc.child(2);
    expect(bullets.childCount).toBe(2);
    expect(bullets.child(0).child(0).textContent.trim()).toBe('Punkt eins');
    // Unterpunkt ist verschachtelt in "Punkt eins"
    expect(bullets.child(0).child(1).type.name).toBe('bulletList');
    expect(bullets.child(0).child(1).textContent.trim()).toBe('Unterpunkt');
    expect(bullets.child(1).textContent.trim()).toBe('Punkt zwei');
    const ordered = doc.child(3);
    expect(ordered.childCount).toBe(2);
    expect(ordered.textContent).toContain('Schritt zwei');
    // Aufzählungszeichen von Word dürfen nicht im Text landen
    expect(doc.textContent).not.toMatch(/·|^o\s/);
  });
});

describe('Sicheres Einfügen', () => {
  it('verwirft Skripte, Event-Handler und javascript:-Links über das Schema', () => {
    const doc = parse(
      normalizePastedHtml(
        '<p onclick="alert(1)">Hallo <a href="javascript:alert(1)">Link</a></p><script>alert(1)</script><img src="javascript:alert(1)">',
      ),
    );
    expect(types(doc)).toEqual(['paragraph']);
    expect(JSON.stringify(doc.toJSON())).not.toMatch(/javascript|alert|onclick/);
  });

  it('übernimmt iframes nur von erlaubten Anbietern', () => {
    const doc = parse(
      '<iframe src="https://evil.example/x"></iframe><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
    );
    expect(types(doc)).toEqual(['embed']);
    expect(doc.child(0).attrs.url).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
  });
});

describe('Markdown', () => {
  const md = [
    '# Titel',
    '',
    'Ein **fetter** Satz mit `code`.',
    '',
    '- eins',
    '- zwei',
    '',
    '* [x] erledigt',
    '* [ ] offen',
    '',
    '```ts',
    'const a = 1;',
    '```',
    '',
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '<script>alert(1)</script>',
  ].join('\n');

  it('wird erkannt, normaler Text nicht', () => {
    expect(looksLikeMarkdown(md)).toBe(true);
    expect(looksLikeMarkdown('Einfach ein Satz.\nUnd noch einer.')).toBe(false);
    expect(looksLikeMarkdown('- nur ein Punkt')).toBe(false);
  });

  it('wird in Jotion-Blöcke übersetzt, Roh-HTML bleibt Text', () => {
    const doc = parse(markdownToHtml(md));
    expect(types(doc)).toEqual([
      'heading',
      'paragraph',
      'bulletList',
      'taskList',
      'codeBlock',
      'table',
      'paragraph',
    ]);
    expect(marksOf(doc, 'fetter')).toEqual(['bold']);
    expect(marksOf(doc, 'code')).toEqual(['code']);
    const tasks = doc.child(3);
    expect(tasks.child(0).attrs.checked).toBe(true);
    expect(tasks.child(1).attrs.checked).toBe(false);
    expect(doc.child(4).attrs.language).toBe('ts');
    expect(doc.child(6).textContent.trim()).toBe('<script>alert(1)</script>');
  });
});
