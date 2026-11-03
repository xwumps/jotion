import type { UploadKind } from '@jotion/shared';

export interface SniffResult {
  mime: string;
  kind: UploadKind;
  ext: string;
}

const ascii = (buf: Buffer, start: number, end: number) => buf.subarray(start, end).toString('latin1');

/** Office- und OpenDocument-Formate sind ZIP-Container; Endung nur zur Benennung, Auslieferung immer als Download. */
const ZIP_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  epub: 'application/epub+zip',
};

function extOf(name: string | undefined): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name ?? '');
  return m ? m[1]!.toLowerCase() : '';
}

/** Erkennt aktive Inhalte (HTML, SVG, XML), die nie mit ihrem Typ ausgeliefert werden dürfen. */
export function looksLikeMarkup(head: Buffer): boolean {
  const s = head
    .subarray(0, 1024)
    .toString('utf8')
    .replace(/^﻿/, '')
    .trimStart()
    .toLowerCase();
  return /^<(\?xml|!doctype|html|svg|script|head|body|iframe|div|a\s|img|!--)/.test(s);
}

function isText(head: Buffer): boolean {
  if (head.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, Math.min(head.length, 4000)));
    return true;
  } catch {
    // Abgeschnittenes Mehrbyte-Zeichen am Ende ist kein Binärinhalt
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, Math.max(0, Math.min(head.length, 4000) - 4)));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Typ am Inhalt (Magic Bytes) erkennen, nie an Content-Type oder Endung.
 * Bilder werden separat über sharp erkannt und neu kodiert.
 */
export function sniff(head: Buffer, name?: string): SniffResult {
  if (head.length >= 5 && ascii(head, 0, 5) === '%PDF-')
    return { mime: 'application/pdf', kind: 'pdf', ext: 'pdf' };
  if (head.length >= 12 && ascii(head, 4, 8) === 'ftyp') {
    const brand = ascii(head, 8, 12);
    if (/^M4[AB] /.test(brand)) return { mime: 'audio/mp4', kind: 'audio', ext: 'm4a' };
    if (brand === 'qt  ') return { mime: 'video/quicktime', kind: 'video', ext: 'mov' };
    if (/^(heic|heix|mif1|avif)/.test(brand))
      return { mime: 'application/octet-stream', kind: 'file', ext: 'bin' };
    return { mime: 'video/mp4', kind: 'video', ext: 'mp4' };
  }
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) {
    return ascii(head, 0, 64).includes('webm')
      ? { mime: 'video/webm', kind: 'video', ext: 'webm' }
      : { mime: 'video/x-matroska', kind: 'file', ext: 'mkv' };
  }
  if (head.length >= 4 && ascii(head, 0, 4) === 'OggS')
    return { mime: 'audio/ogg', kind: 'audio', ext: 'ogg' };
  if (head.length >= 4 && ascii(head, 0, 4) === 'fLaC')
    return { mime: 'audio/flac', kind: 'audio', ext: 'flac' };
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF') {
    const type = ascii(head, 8, 12);
    if (type === 'WAVE') return { mime: 'audio/wav', kind: 'audio', ext: 'wav' };
  }
  if (head.length >= 3 && ascii(head, 0, 3) === 'ID3')
    return { mime: 'audio/mpeg', kind: 'audio', ext: 'mp3' };
  if (head.length >= 2 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0 && (head[1]! & 0x06) !== 0)
    return { mime: 'audio/mpeg', kind: 'audio', ext: 'mp3' };
  if (head.length >= 4 && head.readUInt32BE(0) === 0x504b0304) {
    const ext = extOf(name);
    return { mime: ZIP_TYPES[ext] ?? 'application/zip', kind: 'file', ext: ZIP_TYPES[ext] ? ext : 'zip' };
  }
  if (head.length >= 6 && ascii(head, 0, 6) === '7z\xbc\xaf\x27\x1c')
    return { mime: 'application/x-7z-compressed', kind: 'file', ext: '7z' };
  if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b)
    return { mime: 'application/gzip', kind: 'file', ext: 'gz' };
  // HTML, SVG und XML nie mit eigenem Typ (sonst Skriptausführung im eigenen Origin)
  if (looksLikeMarkup(head)) return { mime: 'application/octet-stream', kind: 'file', ext: 'bin' };
  if (isText(head)) {
    const ext = extOf(name);
    if (ext === 'csv') return { mime: 'text/csv', kind: 'file', ext: 'csv' };
    if (ext === 'md') return { mime: 'text/markdown', kind: 'file', ext: 'md' };
    return { mime: 'text/plain', kind: 'file', ext: 'txt' };
  }
  return { mime: 'application/octet-stream', kind: 'file', ext: 'bin' };
}

/** Bildformate, die sharp liest und neu kodiert (Magic Bytes) */
export function looksLikeRasterImage(head: Buffer): boolean {
  if (head.length < 12) return false;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return true;
  if (head.readUInt32BE(0) === 0x89504e47) return true;
  if (ascii(head, 0, 4) === 'GIF8') return true;
  return ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP';
}
