import type { FilterGroup, PropertyType, PropertyValue, SortSpec } from '@jotion/shared';

/** Property, wie Compiler und Referenz sie brauchen (config bereits validiert). */
export interface QueryProperty {
  id: string;
  type: PropertyType;
  config: unknown;
}

/** Zeile für die JS-Referenz (gleiche Daten wie in pages + property_values). */
export interface RowRecord {
  id: string;
  title: string;
  position: string;
  createdAt: string;
  createdById: string;
  lastEditedAt: string;
  lastEditedById: string;
  /** gespeicherte Werte im API-Format, leere fehlen */
  values: Record<string, PropertyValue>;
}

export interface QueryContext {
  databaseId: string;
  /** Nur Zeilen, die dieser Nutzer sehen darf (Scope/Owner der Seite) */
  viewerId: string;
  properties: QueryProperty[];
  filter?: FilterGroup | null;
  sorts?: SortSpec[];
  search?: string;
  /** IANA-Zeitzone für Datumsvergleiche (Standard UTC) */
  timeZone?: string;
  /** Bezugszeitpunkt für relative Datumsangaben (Standard: jetzt) */
  now?: Date;
  /** Namen von Nutzern für Sortierung nach Person (nur Referenz; SQL liest users) */
  userNames?: Record<string, string>;
}
