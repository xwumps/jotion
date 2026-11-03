/**
 * Normalisierung von eingefügtem HTML (Google Docs, Word, Webseiten) und Markdown.
 * Läuft im Browser vor dem Parsen durch das ProseMirror-Schema. Das Schema entscheidet am Ende,
 * was übernommen wird; hier werden nur Formatierungen aus Inline-Styles in Tags übersetzt und
 * Word-Listen in echte Listen umgebaut.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { marked } from 'marked';

const BLOCK_STYLE_TAGS = new Set(['P', 'DIV', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

function wrap(doc: Document, el: Element, tag: string): void {
  const w = doc.createElement(tag);
  while (el.firstChild) w.appendChild(el.firstChild);
  el.appendChild(w);
}

function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

/** Inline-Styles (Google Docs, Word) in semantische Tags übersetzen. */
function styleToTags(doc: Document, root: Element): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('span[style], font[style]'))) {
    const style = (el.getAttribute('style') ?? '').toLowerCase().replace(/\s+/g, '');
    const weight = /font-weight:(\d+|bold|bolder)/.exec(style)?.[1];
    if (weight && (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600))
      wrap(doc, el, 'strong');
    if (style.includes('font-style:italic')) wrap(doc, el, 'em');
    if (/text-decoration[^;]*underline/.test(style)) wrap(doc, el, 'u');
    if (/text-decoration[^;]*line-through/.test(style)) wrap(doc, el, 's');
    if (/vertical-align:super/.test(style)) {
      /* hochgestellt wird nicht unterstützt, Text bleibt erhalten */
    }
  }
}

/** Google Docs: Wrapper `<b id="docs-internal-guid-...">` mit font-weight:normal entfernen. */
function cleanGoogleDocs(root: Element): void {
  for (const b of Array.from(root.querySelectorAll('b[id^="docs-internal-guid"]'))) unwrap(b);
  // Fett per <b style="font-weight:normal"> ist nicht fett
  for (const b of Array.from(root.querySelectorAll<HTMLElement>('b[style]'))) {
    if (/font-weight:\s*(normal|400)/i.test(b.getAttribute('style') ?? '')) unwrap(b);
  }
  // Google Docs packt Listeneinträge in <p> mit role=presentation, das ist für das Schema ok
  for (const br of Array.from(root.querySelectorAll('br.Apple-interchange-newline'))) br.remove();
}

interface WordListItem {
  el: HTMLElement;
  level: number;
  ordered: boolean;
  listId: string;
}

/** Word: Listen sind Absätze mit `mso-list` im Stil. In echte ul/ol mit Verschachtelung umbauen. */
function convertWordLists(doc: Document, root: Element): void {
  const paras = Array.from(root.querySelectorAll<HTMLElement>('p'));
  const items: WordListItem[] = [];
  for (const p of paras) {
    const style = p.getAttribute('style') ?? '';
    const m = /mso-list:\s*(l\d+)\s+level(\d+)/i.exec(style);
    if (!m && !/MsoListParagraph/i.test(p.className)) continue;
    // Aufzählungszeichen steht in einem Span mit mso-list:Ignore
    let marker = '';
    for (const ign of Array.from(p.querySelectorAll<HTMLElement>('span[style]'))) {
      if (/mso-list:\s*ignore/i.test(ign.getAttribute('style') ?? '')) {
        marker += ign.textContent ?? '';
        ign.remove();
      }
    }
    marker = marker.replace(/ /g, ' ').trim();
    const ordered = /^(\d+|[a-z]|[ivxlc]+)[.)]$/i.test(marker);
    items.push({
      el: p,
      level: m ? Number(m[2]) : 1,
      ordered,
      listId: m?.[1] ?? 'l0',
    });
  }
  if (!items.length) return;

  // Aufeinanderfolgende Einträge (gleiche Geschwisterkette) zu einer Liste zusammenfassen
  let i = 0;
  while (i < items.length) {
    const group: WordListItem[] = [items[i]!];
    let j = i + 1;
    while (j < items.length) {
      let prev: Node | null = group[group.length - 1]!.el.nextSibling;
      while (prev && prev.nodeType === 3 && !(prev.textContent ?? '').trim())
        prev = prev.nextSibling;
      if (prev !== items[j]!.el) break;
      group.push(items[j]!);
      j++;
    }
    buildList(doc, group);
    i = j;
  }
}

function buildList(doc: Document, group: WordListItem[]): void {
  const first = group[0]!;
  const minLevel = Math.min(...group.map((g) => g.level));
  const stack: { list: HTMLElement; level: number }[] = [];
  const top = doc.createElement(first.ordered ? 'ol' : 'ul');
  first.el.parentNode?.insertBefore(top, first.el);
  stack.push({ list: top, level: minLevel });
  let lastLi: HTMLElement | null = null;
  for (const item of group) {
    while (stack.length > 1 && item.level < stack[stack.length - 1]!.level) stack.pop();
    if (item.level > stack[stack.length - 1]!.level && lastLi) {
      const nested = doc.createElement(item.ordered ? 'ol' : 'ul');
      lastLi.appendChild(nested);
      stack.push({ list: nested, level: item.level });
    }
    const li = doc.createElement('li');
    const p = doc.createElement('p');
    while (item.el.firstChild) p.appendChild(item.el.firstChild);
    li.appendChild(p);
    stack[stack.length - 1]!.list.appendChild(li);
    item.el.remove();
    lastLi = li;
  }
}

/** Word: Steuerelemente, bedingte Kommentare und Office-Namespaces entfernen. */
function cleanWord(root: Element): void {
  for (const el of Array.from(root.querySelectorAll('style, meta, link, xml, script, title')))
    el.remove();
  // <o:p> und andere Elemente mit Namespace-Präfix
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el.tagName.includes(':')) {
      if (/^O:P$/i.test(el.tagName) && !(el.textContent ?? '').trim()) el.remove();
      else unwrap(el);
    }
  }
  // Word-Titel und Überschriften über Klassen
  for (const p of Array.from(root.querySelectorAll<HTMLElement>('p[class]'))) {
    const cls = p.className;
    const level = /MsoHeading(\d)/i.exec(cls)?.[1] ?? (/MsoTitle/i.test(cls) ? '1' : null);
    if (level) {
      const h = root.ownerDocument.createElement(`h${Math.min(3, Number(level))}`);
      while (p.firstChild) h.appendChild(p.firstChild);
      p.replaceWith(h);
    }
  }
}

function removeComments(root: Node): void {
  const walker = root.ownerDocument!.createTreeWalker(root, 128 /* NodeFilter.SHOW_COMMENT */);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const c of comments) c.parentNode?.removeChild(c);
}

/** Überschriften h4 bis h6 auf h3 abbilden (Jotion kennt drei Ebenen). */
function clampHeadings(doc: Document, root: Element): void {
  for (const h of Array.from(root.querySelectorAll('h4, h5, h6'))) {
    const n = doc.createElement('h3');
    while (h.firstChild) n.appendChild(h.firstChild);
    h.replaceWith(n);
  }
}

/** Leere Absätze, die nur aus nbsp bestehen (Word, Google Docs), entfernen. */
function dropEmptyParagraphs(root: Element): void {
  for (const p of Array.from(root.querySelectorAll('p'))) {
    if (p.querySelector('img, br')) continue;
    if (!(p.textContent ?? '').replace(/ /g, '').trim()) p.remove();
  }
}

export function isWordHtml(html: string): boolean {
  return /urn:schemas-microsoft-com:office|class="?Mso|mso-list/i.test(html);
}

export function isGoogleDocsHtml(html: string): boolean {
  return /docs-internal-guid/.test(html);
}

/** Bereinigt eingefügtes HTML für das Jotion-Schema. */
export function normalizePastedHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.body;
  removeComments(root);
  if (isWordHtml(html)) {
    cleanWord(root);
    convertWordLists(doc, root);
    dropEmptyParagraphs(root);
  }
  if (isGoogleDocsHtml(html)) cleanGoogleDocs(root);
  styleToTags(doc, root);
  clampHeadings(doc, root);
  // Absätze, die nur Bilder enthalten, durch die Bilder ersetzen (sonst bleibt ein leerer Absatz)
  for (const p of Array.from(root.querySelectorAll('p'))) {
    const imgs = Array.from(p.querySelectorAll('img'));
    if (imgs.length && !(p.textContent ?? '').replace(/ /g, '').trim()) p.replaceWith(...imgs);
  }
  // Zeilenumbrüche direkt zwischen Blöcken (Google Docs) erzeugen sonst leere Absätze
  for (const br of Array.from(root.children)) if (br.tagName === 'BR') br.remove();
  // Absätze direkt in Listeneinträgen mit Stil-Containern bleiben, das Schema räumt auf
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[style]'))) {
    if (!BLOCK_STYLE_TAGS.has(el.tagName)) continue;
    el.removeAttribute('style');
  }
  return root.innerHTML;
}

/**
 * Erkennt, ob reiner Text als Markdown gemeint ist (Überschriften, Listen, Codeblöcke,
 * Tabellen, Fett). Einzelne Zeilen ohne Markdown bleiben normaler Text.
 */
export function looksLikeMarkdown(text: string): boolean {
  if (text.length > 500_000) return false;
  const lines = text.split(/\r?\n/);
  let score = 0;
  for (const line of lines) {
    if (/^#{1,6}\s+\S/.test(line)) score += 2;
    else if (/^\s*([-*+]|\d+[.)])\s+\S/.test(line)) score += 1;
    else if (/^\s*[-*]\s+\[[ xX]\]\s/.test(line)) score += 2;
    else if (/^```/.test(line)) score += 2;
    else if (/^>\s/.test(line)) score += 1;
    else if (/^\|.*\|\s*$/.test(line)) score += 1;
    if (/\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)]+\)/.test(line)) score += 1;
    if (score >= 2) return true;
  }
  return false;
}

/**
 * Markdown in HTML für das Schema übersetzen. To-dos (`- [ ]`) werden zu Tiptap-Tasklisten,
 * Roh-HTML im Markdown wird als Text behandelt (kein Einschleusen von HTML).
 */
export function markdownToHtml(md: string): string {
  const renderer = new marked.Renderer();
  renderer.html = ({ text }) => escapeHtml(text);
  const html = marked.parse(md, { async: false, gfm: true, breaks: false, renderer });
  if (typeof DOMParser === 'undefined') return html;
  // GFM-Tasklisten (<li><input type="checkbox" checked> Text</li>) in Tiptap-Tasklisten umbauen
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const ul of Array.from(doc.querySelectorAll('ul'))) {
    const items = Array.from(ul.children).filter((c) => c.tagName === 'LI');
    const box = (li: Element) => {
      const input = li.querySelector('input[type="checkbox"]');
      if (!input) return null;
      const parent = input.parentElement;
      return parent === li || (parent?.tagName === 'P' && parent.parentElement === li)
        ? input
        : null;
    };
    if (!items.length || !items.every((li) => box(li))) continue;
    ul.setAttribute('data-type', 'taskList');
    for (const li of items) {
      const input = box(li)!;
      li.setAttribute('data-type', 'taskItem');
      li.setAttribute('data-checked', String(input.hasAttribute('checked')));
      input.remove();
      if (!Array.from(li.children).some((c) => c.tagName === 'P')) {
        const p = doc.createElement('p');
        while (li.firstChild && !['UL', 'OL'].includes((li.firstChild as Element).tagName ?? ''))
          p.appendChild(li.firstChild);
        li.insertBefore(p, li.firstChild);
      }
      const first = li.querySelector('p')?.firstChild;
      if (first?.nodeType === 3) first.textContent = (first.textContent ?? '').trimStart();
    }
  }
  return doc.body.innerHTML;
}

const SEMANTIC_TAGS = /<(p|h[1-6]|ul|ol|li|table|pre|blockquote|img|strong|em|b|i|a)\b/i;

/**
 * Einfügen im Editor: HTML normalisieren, Markdown aus Text (oder aus HTML ohne Struktur,
 * z. B. aus Code-Editoren) als formatierten Inhalt übernehmen.
 */
export const PasteHandler = Extension.create({
  name: 'jotionPaste',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('jotion-paste'),
        props: {
          transformPastedHTML: (html) => normalizePastedHtml(html),
          handlePaste: (view, event) => {
            const cd = event.clipboardData;
            if (!cd || cd.files.length) return false;
            const { $from } = view.state.selection;
            if ($from.parent.type.spec.code) return false;
            const html = cd.getData('text/html');
            if (html && SEMANTIC_TAGS.test(html)) return false;
            const text = cd.getData('text/plain');
            if (!text || !looksLikeMarkdown(text)) return false;
            return editor.commands.insertContent(markdownToHtml(text));
          },
        },
      }),
    ];
  },
});

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
