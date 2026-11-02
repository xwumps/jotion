import { describe, expect, it } from 'vitest';
import de from '../../messages/de.json';
import en from '../../messages/en.json';

// Em-Dash (U+2014) als Code, damit das Zeichen selbst nicht im Quelltext steht
const EM_DASH = String.fromCharCode(0x2014);

function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object'
      ? keys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe('Übersetzungen', () => {
  it('Deutsch und Englisch haben dieselben Schlüssel', () => {
    expect(keys(en).sort()).toEqual(keys(de).sort());
  });

  it('enthalten keine leeren Texte und keine Em-Dashes', () => {
    for (const messages of [de, en]) {
      const flat = JSON.stringify(messages);
      expect(flat).not.toContain('""');
      expect(flat).not.toContain(EM_DASH);
    }
  });
});
