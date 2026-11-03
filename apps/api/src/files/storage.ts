import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

/** Abstraktion für Dateiablage. Phase 1: lokales Verzeichnis (Docker-Volume). S3 folgt optional. */
export interface StorageDriver {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string, range?: { start: number; end: number }): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export class LocalStorageDriver implements StorageDriver {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Verhindert Pfad-Traversal: Schlüssel muss innerhalb des Wurzelverzeichnisses bleiben. */
  private path(key: string): string {
    if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes('..'))
      throw new Error('Ungültiger Speicherschlüssel');
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error('Ungültiger Speicherschlüssel');
    return p;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    // Atomar schreiben: erst temporär, dann umbenennen
    const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, data);
    await rename(tmp, p);
  }

  async get(key: string, range?: { start: number; end: number }): Promise<Readable> {
    const p = this.path(key);
    await stat(p);
    return createReadStream(p, range);
  }

  /**
   * Schreibt einen Upload-Stream in eine temporäre Datei (Größenlimit, SHA-256, erste Bytes
   * für die Typerkennung), ohne die ganze Datei im Speicher zu halten.
   */
  async writeTemp(
    source: Readable,
    maxBytes: number,
  ): Promise<{ tmp: string; size: number; sha256: string; head: Buffer; tooLarge: boolean }> {
    const dir = join(this.root, '.tmp');
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, randomUUID());
    const hash = createHash('sha256');
    const headChunks: Buffer[] = [];
    let headLen = 0;
    let size = 0;
    let tooLarge = false;
    const out = createWriteStream(tmp);
    try {
      for await (const chunk of source as AsyncIterable<Buffer>) {
        size += chunk.length;
        if (size > maxBytes) {
          tooLarge = true;
          break;
        }
        hash.update(chunk);
        if (headLen < 4096) {
          headChunks.push(chunk);
          headLen += chunk.length;
        }
        if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
      }
    } finally {
      await new Promise<void>((r) => out.end(r));
    }
    if (tooLarge) {
      source.resume?.();
      await rm(tmp, { force: true });
    }
    return {
      tmp,
      size,
      sha256: hash.digest('hex'),
      head: Buffer.concat(headChunks).subarray(0, 4096),
      tooLarge,
    };
  }

  async adoptTemp(tmp: string, key: string): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await rename(tmp, p);
  }

  async discardTemp(tmp: string): Promise<void> {
    await rm(tmp, { force: true });
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
}
