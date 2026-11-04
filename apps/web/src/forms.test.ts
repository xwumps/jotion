import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsxFiles(p);
    return p.endsWith('.tsx') ? [p] : [];
  });
}

describe('Formulare', () => {
  it('senden nie per GET (sonst landen z. B. Passwörter vor der Hydrierung in der URL)', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(join(__dirname))) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/<form\b[^>]*>/g)) {
        if (!/\bmethod="post"/.test(match[0])) offenders.push(`${file}: ${match[0].slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
