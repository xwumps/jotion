import { marked, type Token, type Tokens } from 'marked';
import type { PmNode } from './projection';

/**
 * Phase 12: Markdown ↔ ProseMirror-JSON und HTML-Export, ohne DOM (läuft im Server).
 * Import: GFM mit Überschriften, Listen, To-dos, Zitaten, Code, Tabellen, Trennlinien, Bildern,
 * Links und Inline-Formatierung. Roh-HTML wird als Text übernommen (kein Einschleusen).
 */

type Mark = NonNullable<PmNode['marks']>[number];

export interface MarkdownImportOptions {
  /** Bildquelle auflösen (z. B. relative Pfade aus einem ZIP); null = Bild weglassen */
  resolveImage?: (src: string) => string | null;
  /** Linkziel umschreiben (z. B. relative Links auf andere Dateien des Imports) */
  resolveLink?: (href: string) => string | null;
}

const SAFE_URL = /^(https?:|mailto:|tel:|\/)/i;

function inline(tokens: Token[] | undefined, marks: Mark[], o: MarkdownImportOptions): PmNode[] {
  const out: PmNode[] = [];
  const text = (t: string, m: Mark[]) => {
    if (!t) return;
    out.push(m.length ? { type: 'text', text: t, marks: m } : { type: 'text', text: t });
  };
  for (const tok of tokens ?? []) {
    switch (tok.type) {
      case 'text':
      case 'escape':
        if ('tokens' in tok && tok.tokens?.length) out.push(...inline(tok.tokens, marks, o));
        else text(decode((tok as Tokens.Text).text), marks);
        break;
      case 'strong':
        out.push(...inline(tok.tokens, [...marks, { type: 'bold' }], o));
        break;
      case 'em':
        out.push(...inline(tok.tokens, [...marks, { type: 'italic' }], o));
        break;
      case 'del':
        out.push(...inline(tok.tokens, [...marks, { type: 'strike' }], o));
        break;
      case 'codespan':
        text(decode(tok.text), [...marks, { type: 'code' }]);
        break;
      case 'br':
        out.push({ type: 'hardBreak' });
        break;
      case 'link': {
        const href = o.resolveLink ? o.resolveLink(tok.href) : tok.href;
        const safe = href && SAFE_URL.test(href) ? href : null;
        out.push(
          ...inline(
            tok.tokens,
            safe ? [...marks, { type: 'link', attrs: { href: safe } }] : marks,
            o,
          ),
        );
        break;
      }
      case 'image':
        // Bilder im Fließtext: als Text (Bilder sind Blöcke, siehe paragraph)
        text(tok.text || tok.href, marks);
        break;
      case 'html':
        text(tok.raw, marks);
        break;
      default:
        if ('text' in tok && typeof tok.text === 'string') text(decode(tok.text), marks);
    }
  }
  return out;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

const paragraph = (content: PmNode[]): PmNode =>
  content.length ? { type: 'paragraph', content } : { type: 'paragraph' };

function blocks(tokens: Token[], o: MarkdownImportOptions): PmNode[] {
  const out: PmNode[] = [];
  for (const tok of tokens) {
    switch (tok.type) {
      case 'heading':
        out.push({
          type: 'heading',
          attrs: { level: Math.min(3, tok.depth) },
          content: inline(tok.tokens, [], o),
        });
        break;
      case 'paragraph': {
        // Absatz nur aus Bildern: Bildblöcke
        const imgs = (tok.tokens ?? []).filter((t) => t.type === 'image') as Tokens.Image[];
        const rest = (tok.tokens ?? []).filter(
          (t) => t.type !== 'image' && !(t.type === 'text' && !t.raw.trim()),
        );
        if (imgs.length && !rest.length) {
          for (const img of imgs) {
            const src = o.resolveImage
              ? o.resolveImage(img.href)
              : SAFE_URL.test(img.href)
                ? img.href
                : null;
            if (src) out.push({ type: 'image', attrs: { src, caption: img.text || '' } });
          }
          break;
        }
        out.push(paragraph(inline(tok.tokens, [], o)));
        break;
      }
      case 'text':
        out.push(
          paragraph(
            inline(tok.tokens ?? [{ type: 'text', raw: tok.raw, text: tok.text } as Token], [], o),
          ),
        );
        break;
      case 'blockquote':
        out.push({ type: 'blockquote', content: nonEmpty(blocks(tok.tokens ?? [], o)) });
        break;
      case 'code':
        out.push({
          type: 'codeBlock',
          attrs: { language: tok.lang?.split(/\s/)[0] || null },
          ...(tok.text ? { content: [{ type: 'text', text: tok.text }] } : {}),
        });
        break;
      case 'hr':
        out.push({ type: 'horizontalRule' });
        break;
      case 'list': {
        const isTask = tok.items.length > 0 && tok.items.every((i: Tokens.ListItem) => i.task);
        const items = tok.items.map((i: Tokens.ListItem) => {
          const content = nonEmpty(
            blocks(
              i.tokens.filter((t) => t.type !== 'checkbox'),
              o,
            ),
          );
          return isTask
            ? { type: 'taskItem', attrs: { checked: !!i.checked }, content }
            : { type: 'listItem', content };
        });
        out.push({
          type: isTask ? 'taskList' : tok.ordered ? 'orderedList' : 'bulletList',
          ...(tok.ordered && !isTask && tok.start && tok.start !== 1
            ? { attrs: { start: tok.start } }
            : {}),
          content: items,
        });
        break;
      }
      case 'table': {
        const cell = (c: Tokens.TableCell, header: boolean): PmNode => ({
          type: header ? 'tableHeader' : 'tableCell',
          content: [paragraph(inline(c.tokens, [], o))],
        });
        out.push({
          type: 'table',
          content: [
            { type: 'tableRow', content: tok.header.map((c: Tokens.TableCell) => cell(c, true)) },
            ...tok.rows.map((r: Tokens.TableCell[]) => ({
              type: 'tableRow',
              content: r.map((c) => cell(c, false)),
            })),
          ],
        });
        break;
      }
      case 'html':
        if (tok.text.trim()) out.push(paragraph([{ type: 'text', text: tok.text.trim() }]));
        break;
      case 'space':
        break;
      default:
        if ('text' in tok && typeof tok.text === 'string' && tok.text.trim())
          out.push(paragraph([{ type: 'text', text: tok.text }]));
    }
  }
  return out;
}

const nonEmpty = (nodes: PmNode[]): PmNode[] => (nodes.length ? nodes : [{ type: 'paragraph' }]);

/** Markdown in Blöcke; die erste H1 kann als Titel dienen (titleFromHeading). */
export function markdownToPm(
  md: string,
  o: MarkdownImportOptions & { titleFromHeading?: boolean } = {},
): { title: string | null; content: PmNode[] } {
  const tokens = marked.lexer(md.replace(/\r\n?/g, '\n'), { gfm: true });
  let title: string | null = null;
  if (o.titleFromHeading) {
    const i = tokens.findIndex((t) => t.type !== 'space');
    const first = tokens[i];
    if (first?.type === 'heading' && first.depth === 1) {
      title = decode(first.text).trim();
      tokens.splice(i, 1);
    }
  }
  return { title, content: blocks(tokens, o) };
}

// ------------------------------------------------------------------ Export

export interface ExportOptions {
  /** Ziel einer Seiten-Referenz (Unterseite, Link zu Seite) */
  pageLink?: (pageId: string) => { title: string; href: string } | null;
  /** Bild- und Dateiquellen umschreiben (z. B. auf Dateien im ZIP) */
  mediaSrc?: (src: string) => string;
}

const textOf = (n: PmNode): string =>
  n.type === 'text' ? (n.text ?? '') : (n.content ?? []).map(textOf).join('');

function mdInline(nodes: PmNode[] | undefined, o: ExportOptions): string {
  let out = '';
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') {
      out += '  \n';
      continue;
    }
    if (n.type === 'mention') {
      const a = n.attrs ?? {};
      const ref =
        a.kind === 'page' && typeof a.targetId === 'string' ? o.pageLink?.(a.targetId) : null;
      out += ref ? `[${ref.title}](${ref.href})` : `@${String(a.label ?? a.date ?? '')}`;
      continue;
    }
    if (n.type === 'mathInline') {
      out += `$${String(n.attrs?.latex ?? '')}$`;
      continue;
    }
    if (n.type !== 'text') {
      out += mdInline(n.content, o);
      continue;
    }
    let t = (n.text ?? '').replace(/([\\`*_[\]#<>|])/g, '\\$1');
    const marks = n.marks ?? [];
    if (marks.some((m) => m.type === 'code')) t = `\`${n.text ?? ''}\``;
    if (marks.some((m) => m.type === 'bold')) t = `**${t}**`;
    if (marks.some((m) => m.type === 'italic')) t = `*${t}*`;
    if (marks.some((m) => m.type === 'strike')) t = `~~${t}~~`;
    const link = marks.find((m) => m.type === 'link');
    if (link) t = `[${t}](${String(link.attrs?.href ?? '')})`;
    out += t;
  }
  return out;
}

function mdBlocks(nodes: PmNode[], o: ExportOptions, indent = ''): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    const a = n.attrs ?? {};
    switch (n.type) {
      case 'paragraph':
        out.push(indent + mdInline(n.content, o));
        break;
      case 'heading':
        out.push(`${indent}${'#'.repeat(Number(a.level) || 1)} ${mdInline(n.content, o)}`);
        break;
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        (n.content ?? []).forEach((item, i) => {
          const marker =
            n.type === 'orderedList'
              ? `${(Number(a.start) || 1) + i}.`
              : n.type === 'taskList'
                ? `- [${item.attrs?.checked ? 'x' : ' '}]`
                : '-';
          // Eng gesetzte Liste: Fortsetzungszeilen unter den Text des Eintrags einrücken
          const pad = ' '.repeat(n.type === 'taskList' ? 2 : marker.length + 1);
          const lines = mdBlocks(item.content ?? [], o)
            .join('\n')
            .split('\n')
            .filter((l) => l !== '');
          lines.forEach((l, j) =>
            out.push(j === 0 ? `${indent}${marker} ${l}` : `${indent}${pad}${l}`),
          );
        });
        out.push('');
        continue;
      case 'blockquote':
      case 'callout': {
        const lines = mdBlocks(n.content ?? [], o)
          .join('\n')
          .trim()
          .split('\n');
        if (n.type === 'callout' && a.icon) lines[0] = `${String(a.icon)} ${lines[0] ?? ''}`;
        for (const line of lines) out.push(`${indent}> ${line}`.trimEnd());
        break;
      }
      case 'codeBlock':
        out.push(`${indent}\`\`\`${String(a.language ?? '')}\n${textOf(n)}\n${indent}\`\`\``);
        break;
      case 'horizontalRule':
        out.push(`${indent}---`);
        break;
      case 'image':
      case 'video':
      case 'audio':
      case 'file':
      case 'pdf': {
        const src = typeof a.src === 'string' ? (o.mediaSrc?.(a.src) ?? a.src) : '';
        if (!src) break;
        const label = String(a.caption || a.name || n.type);
        out.push(
          n.type === 'image' ? `${indent}![${label}](${src})` : `${indent}[${label}](${src})`,
        );
        break;
      }
      case 'bookmark':
      case 'embed':
        if (a.url) out.push(`${indent}<${String(a.url)}>`);
        break;
      case 'subpage':
      case 'pageLink': {
        const ref = typeof a.pageId === 'string' ? o.pageLink?.(a.pageId) : null;
        if (ref) out.push(`${indent}[${ref.title}](${ref.href})`);
        break;
      }
      case 'mathBlock':
        out.push(`${indent}$$\n${String(a.latex ?? '')}\n$$`);
        break;
      case 'details':
        out.push(...mdBlocks(n.content ?? [], o, indent));
        continue;
      case 'table': {
        const rows = (n.content ?? []).map((r) =>
          (r.content ?? []).map((c) =>
            mdInline(
              (c.content ?? []).flatMap((p) => p.content ?? []),
              o,
            ).replace(/\n/g, ' '),
          ),
        );
        if (!rows.length) break;
        const width = Math.max(...rows.map((r) => r.length));
        const line = (r: string[]) =>
          `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
        out.push(
          [line(rows[0]!), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)]
            .map((l) => indent + l)
            .join('\n'),
        );
        break;
      }
      default:
        if (n.content?.length) out.push(...mdBlocks(n.content, o, indent));
    }
    out.push('');
  }
  // Leere Zeilen zwischen Blöcken, aber nicht doppelt
  return out.filter((l, i, arr) => !(l === '' && arr[i - 1] === ''));
}

export function pmToMarkdown(title: string, content: PmNode[], o: ExportOptions = {}): string {
  const body = mdBlocks(content, o)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return `# ${title || 'Ohne Titel'}\n\n${body}\n`;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function htmlInline(nodes: PmNode[] | undefined, o: ExportOptions): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === 'hardBreak') return '<br>';
      if (n.type === 'mention') {
        const a = n.attrs ?? {};
        const ref =
          a.kind === 'page' && typeof a.targetId === 'string' ? o.pageLink?.(a.targetId) : null;
        return ref
          ? `<a href="${esc(ref.href)}">${esc(ref.title)}</a>`
          : `<span class="mention">@${esc(String(a.label ?? a.date ?? ''))}</span>`;
      }
      if (n.type !== 'text') return htmlInline(n.content, o);
      let t = esc(n.text ?? '');
      for (const m of n.marks ?? []) {
        if (m.type === 'bold') t = `<strong>${t}</strong>`;
        else if (m.type === 'italic') t = `<em>${t}</em>`;
        else if (m.type === 'strike') t = `<s>${t}</s>`;
        else if (m.type === 'underline') t = `<u>${t}</u>`;
        else if (m.type === 'code') t = `<code>${t}</code>`;
        else if (m.type === 'link') {
          const href = String(m.attrs?.href ?? '');
          if (SAFE_URL.test(href)) t = `<a href="${esc(href)}">${t}</a>`;
        }
      }
      return t;
    })
    .join('');
}

function htmlBlocks(nodes: PmNode[], o: ExportOptions): string {
  return nodes
    .map((n) => {
      const a = n.attrs ?? {};
      const inner = () => htmlBlocks(n.content ?? [], o);
      switch (n.type) {
        case 'paragraph':
          return `<p>${htmlInline(n.content, o)}</p>`;
        case 'heading': {
          const l = Math.min(6, Math.max(1, Number(a.level) || 1)) + 1;
          return `<h${l}>${htmlInline(n.content, o)}</h${l}>`;
        }
        case 'bulletList':
          return `<ul>${inner()}</ul>`;
        case 'orderedList':
          return `<ol${Number(a.start) > 1 ? ` start="${Number(a.start)}"` : ''}>${inner()}</ol>`;
        case 'taskList':
          return `<ul class="tasks">${inner()}</ul>`;
        case 'listItem':
          return `<li>${inner()}</li>`;
        case 'taskItem':
          return `<li><input type="checkbox" disabled${a.checked ? ' checked' : ''}> ${inner()}</li>`;
        case 'blockquote':
          return `<blockquote>${inner()}</blockquote>`;
        case 'callout':
          return `<aside class="callout">${a.icon ? `<span>${esc(String(a.icon))}</span>` : ''}${inner()}</aside>`;
        case 'codeBlock':
          return `<pre><code${a.language ? ` class="language-${esc(String(a.language))}"` : ''}>${esc(textOf(n))}</code></pre>`;
        case 'horizontalRule':
          return '<hr>';
        case 'details':
          return `<details open>${inner()}</details>`;
        case 'detailsSummary':
          return `<summary>${htmlInline(n.content, o)}</summary>`;
        case 'detailsContent':
          return inner();
        case 'image': {
          const src = typeof a.src === 'string' ? (o.mediaSrc?.(a.src) ?? a.src) : '';
          return src
            ? `<figure><img src="${esc(src)}" alt="${esc(String(a.caption ?? ''))}">${a.caption ? `<figcaption>${esc(String(a.caption))}</figcaption>` : ''}</figure>`
            : '';
        }
        case 'video':
        case 'audio':
        case 'file':
        case 'pdf': {
          const src = typeof a.src === 'string' ? (o.mediaSrc?.(a.src) ?? a.src) : '';
          return src
            ? `<p><a href="${esc(src)}">${esc(String(a.caption || a.name || n.type))}</a></p>`
            : '';
        }
        case 'bookmark':
        case 'embed':
          return a.url && SAFE_URL.test(String(a.url))
            ? `<p><a href="${esc(String(a.url))}">${esc(String(a.title || a.url))}</a></p>`
            : '';
        case 'subpage':
        case 'pageLink': {
          const ref = typeof a.pageId === 'string' ? o.pageLink?.(a.pageId) : null;
          return ref
            ? `<p class="page-link"><a href="${esc(ref.href)}">${esc(ref.title)}</a></p>`
            : '';
        }
        case 'mathBlock':
          return `<pre class="math">${esc(String(a.latex ?? ''))}</pre>`;
        case 'table':
          return `<table>${inner()}</table>`;
        case 'tableRow':
          return `<tr>${inner()}</tr>`;
        case 'tableHeader':
          return `<th>${inner()}</th>`;
        case 'tableCell':
          return `<td>${inner()}</td>`;
        case 'columnList':
          return `<div class="columns">${inner()}</div>`;
        case 'column':
          return `<div class="column">${inner()}</div>`;
        default:
          return n.content?.length ? inner() : '';
      }
    })
    .join('\n');
}

export function pmToHtml(title: string, content: PmNode[], o: ExportOptions = {}): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || 'Ohne Titel')}</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#37352f}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:.3rem .5rem}blockquote,.callout{border-left:3px solid #ccc;margin:0;padding-left:1rem}.columns{display:flex;gap:1rem}.column{flex:1}ul.tasks{list-style:none;padding-left:0}pre{background:#f6f5f4;padding:.75rem;overflow:auto}</style>
</head>
<body>
<h1>${esc(title || 'Ohne Titel')}</h1>
${htmlBlocks(content, o)}
</body>
</html>
`;
}
