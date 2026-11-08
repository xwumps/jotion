import { z } from 'zod';
import { pageIconSchema } from './contracts';

/** Phase 9: Vorlagen (Galerie, eigene Vorlagen, Zeilen-Vorlagen von Datenbanken). */

const id = z.uuid();

export const TEMPLATE_CATEGORIES = ['productivity', 'school', 'knowledge', 'custom'] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export interface TemplateDto {
  /** "builtin:<key>" oder Seiten-ID einer eigenen Vorlage */
  id: string;
  builtin: boolean;
  title: string;
  description: string;
  icon: z.output<typeof pageIconSchema> | null;
  category: TemplateCategory;
  /** Eigene Vorlagen: Bereich der Vorlage */
  scope: 'PRIVATE' | 'TEAM' | null;
}

export const useTemplateSchema = z
  .object({
    templateId: z.string().min(1).max(64),
    /** Unter dieser Seite anlegen; ohne Angabe auf oberster Ebene */
    parentId: id.nullable().default(null),
    scope: z.enum(['PRIVATE', 'TEAM']).optional(),
  })
  .strict();

export const setTemplateSchema = z.object({ isTemplate: z.boolean() }).strict();

/** Wiederholung einer Zeilen-Vorlage */
export const RECURRENCE_EVERY = ['day', 'week', 'month'] as const;
export const recurrenceSchema = z
  .object({
    every: z.enum(RECURRENCE_EVERY),
    /** Uhrzeit HH:MM in JOTION_TIMEZONE */
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default('07:00'),
    /** Wochentag 1 (Montag) bis 7 (Sonntag) bei "week" */
    weekday: z.number().int().min(1).max(7).default(1),
    /** Tag im Monat 1 bis 28 bei "month" */
    monthday: z.number().int().min(1).max(28).default(1),
  })
  .strict();
export type Recurrence = z.output<typeof recurrenceSchema>;

export const createRowTemplateSchema = z
  .object({
    title: z.string().trim().max(200).default(''),
    /** Bestehende Zeile als Vorlage übernehmen (Werte und Inhalt) */
    fromRowId: id.optional(),
  })
  .strict();

export const updateRowTemplateSchema = z
  .object({
    isDefault: z.boolean().optional(),
    recurrence: recurrenceSchema.nullable().optional(),
  })
  .strict();

export interface RowTemplateDto {
  id: string;
  title: string;
  icon: z.output<typeof pageIconSchema> | null;
  isDefault: boolean;
  recurrence: Recurrence | null;
  nextRunAt: string | null;
}

/** Zeile aus Vorlage anlegen (Standardvorlage greift automatisch, "none" verhindert das) */
export const rowTemplateRefSchema = z.union([id, z.literal('none')]);
