/** Zentrale Branding-Konstanten. Name und Texte nur hier pflegen. */
export const BRAND = {
  name: 'Jotion',
  tagline: {
    de: 'Dein Workspace für Notizen, Wissen und Projekte.',
    en: 'Your workspace for notes, knowledge and projects.',
  },
  /** Muster für Browser-Titel: "Seitentitel | Jotion" */
  titleTemplate: '%s | Jotion',
} as const;

export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'de';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
