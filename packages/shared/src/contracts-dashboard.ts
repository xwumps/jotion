/**
 * Phase 7: Dashboard (Startseite) mit Widgets im 12-Spalten-Raster und die Agenda
 * ("Anstehend", "Überfällig") über alle sichtbaren Datenbanken.
 */
import { z } from 'zod';
import type { PageIcon } from './contracts';
import type { DateValue } from './contracts-database';

const id = z.uuid();

export const WIDGET_TYPES = [
  'upcoming',
  'overdue',
  'board',
  'chart',
  'calendar',
  'kpi',
  'recent',
  'favorites',
  'note',
  'links',
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

/** Widgets, die eine Datenbank-Ansicht zeigen */
export const VIEW_WIDGETS: WidgetType[] = ['board', 'chart', 'calendar', 'kpi'];

export const widgetSchema = z
  .object({
    id: z.string().min(1).max(64),
    type: z.enum(WIDGET_TYPES),
    title: z.string().max(200).default(''),
    x: z.number().int().min(0).max(11),
    y: z.number().int().min(0).max(1000),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(40),
    /** Datenbank-Ansicht (Board, Chart, Kalender, KPI) */
    databaseId: id.nullable().default(null),
    viewId: id.nullable().default(null),
    /** Anstehend: Tage voraus */
    days: z.number().int().min(1).max(90).default(14),
    /** Schnellnotiz */
    text: z.string().max(5000).default(''),
    /** Link-Liste */
    links: z
      .array(
        z
          .object({
            title: z.string().max(200),
            url: z
              .string()
              .trim()
              .max(2000)
              .regex(/^https?:\/\/|^\//i),
          })
          .strict(),
      )
      .max(30)
      .default([]),
  })
  .strict();
export type Widget = z.output<typeof widgetSchema>;
export type WidgetInput = z.input<typeof widgetSchema>;

export const dashboardSchema = z
  .object({ widgets: z.array(widgetSchema).max(40).default([]) })
  .strict();
export type DashboardConfig = z.output<typeof dashboardSchema>;

export const DASHBOARD_SCOPES = ['personal', 'shared'] as const;
export type DashboardScope = (typeof DASHBOARD_SCOPES)[number];

export interface DashboardDto {
  scope: DashboardScope;
  widgets: Widget[];
  canEdit: boolean;
  /** Noch nie gespeichert (Standard-Widgets) */
  isDefault: boolean;
  updatedAt: string | null;
}

export interface AgendaItemDto {
  rowId: string;
  title: string;
  icon: PageIcon | null;
  databaseId: string;
  databaseTitle: string;
  propertyName: string;
  date: DateValue;
  /** Kalendertag des Beginns in der Zeitzone des Betrachters */
  day: string;
}

export interface AgendaDto {
  upcoming: AgendaItemDto[];
  overdue: AgendaItemDto[];
}

/** Standard-Dashboard für neue Nutzer. */
export function defaultWidgets(): Widget[] {
  const base = { title: '', databaseId: null, viewId: null, days: 14, text: '', links: [] };
  return [
    { ...base, id: 'upcoming', type: 'upcoming', x: 0, y: 0, w: 6, h: 6 },
    { ...base, id: 'overdue', type: 'overdue', x: 6, y: 0, w: 6, h: 6 },
    { ...base, id: 'recent', type: 'recent', x: 0, y: 6, w: 6, h: 6 },
    { ...base, id: 'favorites', type: 'favorites', x: 6, y: 6, w: 6, h: 6 },
  ];
}
