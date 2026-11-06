'use client';

import type {
  CalculationResultDto,
  CreatePropertyInput,
  CreateRowInput,
  DatabaseDto,
  FilterGroup,
  MemberDto,
  PropertyDto,
  RowDto,
  RowQueryResultDto,
  SortSpec,
  UpdatePropertyInput,
  UpdateViewInput,
  ViewDto,
} from '@jotion/shared';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';

export const dbKeys = {
  db: (id: string) => ['db', id] as const,
  rows: (dataId: string) => ['dbRows', dataId] as const,
  rowQuery: (dataId: string, dbId: string, viewId: string, search: string) =>
    ['dbRows', dataId, dbId, viewId, search] as const,
  calc: (dataId: string) => ['dbCalc', dataId] as const,
  row: (dataId: string, rowId: string) => ['dbRow', dataId, rowId] as const,
};

export const PAGE_SIZE = 100;

export function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export const useDatabase = (id: string) =>
  useQuery({
    queryKey: dbKeys.db(id),
    queryFn: () => apiGet<DatabaseDto>(`/databases/${id}`),
    enabled: Boolean(id),
    retry: false,
  });

export const useMembers = (ws: string) =>
  useQuery({
    queryKey: qk.members(ws),
    queryFn: () => apiGet<MemberDto[]>(`/workspaces/${ws}/members`),
    staleTime: 60_000,
  });

/** Zeilen einer Ansicht, seitenweise per Cursor. */
export function useRows(
  db: DatabaseDto,
  view: ViewDto | undefined,
  search: string,
  opts: { preview?: boolean; enabled?: boolean } = {},
) {
  const viewId = view?.id ?? '';
  return useInfiniteQuery({
    queryKey: [...dbKeys.rowQuery(db.dataId, db.id, viewId, search), Boolean(opts.preview)],
    enabled: Boolean(view) && !db.sourceMissing && opts.enabled !== false,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiPost<RowQueryResultDto>(`/databases/${db.id}/query`, {
        viewId,
        search: search || undefined,
        cursor: pageParam,
        limit: PAGE_SIZE,
        timeZone: timeZone(),
        ...(opts.preview ? { preview: true } : {}),
      }),
    getNextPageParam: (last) => last.nextCursor,
    // Beim Neuladen nicht leeren, damit die Tabelle nicht springt
    placeholderData: (prev) => prev,
  });
}

export function useCalculations(db: DatabaseDto, view: ViewDto | undefined, search: string) {
  const has = Object.keys(view?.config.calculations ?? {}).length > 0;
  return useQuery({
    queryKey: [...dbKeys.calc(db.dataId), db.id, view?.id, search, view?.config],
    enabled: Boolean(view) && has && !db.sourceMissing,
    queryFn: () =>
      apiPost<CalculationResultDto>(`/databases/${db.id}/calculate`, {
        viewId: view!.id,
        search: search || undefined,
        timeZone: timeZone(),
      }),
    placeholderData: (prev) => prev,
  });
}

export const useRow = (db: DatabaseDto, rowId: string) =>
  useQuery({
    queryKey: dbKeys.row(db.dataId, rowId),
    queryFn: () => apiGet<RowDto>(`/databases/${db.id}/rows/${rowId}`),
    retry: false,
  });

/** Nach Änderungen an Zeilen: Ansichten, Berechnungen und Einzelzeilen neu laden. */
export function invalidateRows(qc: QueryClient, dataId: string): void {
  void qc.invalidateQueries({ queryKey: dbKeys.rows(dataId) });
  void qc.invalidateQueries({ queryKey: dbKeys.calc(dataId) });
  void qc.invalidateQueries({ queryKey: ['dbRow', dataId] });
}

/** Echtzeit-Ereignis aus useRealtime. */
export function handleDatabaseEvent(qc: QueryClient, type: string, entityId: string): void {
  if (type === 'database.rows.changed') invalidateRows(qc, entityId);
  // Schemaänderungen betreffen auch Linked Databases mit anderer ID
  if (type === 'database.changed') {
    void qc.invalidateQueries({ queryKey: ['db'] });
    invalidateRows(qc, entityId);
  }
}

/**
 * Zeilen in allen geladenen Ansichten ändern. Unter dbKeys.rows liegen seitenweise Listen
 * (Tabelle, Board-Spalten, Liste), einfache Arrays (Kalender, Zeitleiste) und Gruppenzähler;
 * nur die ersten beiden enthalten Zeilen.
 */
function mapRowsInCache(qc: QueryClient, dataId: string, fn: (r: RowDto) => RowDto) {
  qc.setQueriesData<unknown>({ queryKey: dbKeys.rows(dataId) }, (old: unknown) => {
    if (Array.isArray(old)) return (old as RowDto[]).map(fn);
    if (old && typeof old === 'object' && Array.isArray((old as { pages?: unknown }).pages)) {
      const inf = old as InfiniteData<RowQueryResultDto>;
      return { ...inf, pages: inf.pages.map((p) => ({ ...p, rows: p.rows.map(fn) })) };
    }
    return old;
  });
}

/** Zeile in allen geladenen Ansichten ersetzen (sofortige Anzeige ohne Neuladen). */
function patchRowInCache(qc: QueryClient, dataId: string, row: RowDto) {
  mapRowsInCache(qc, dataId, (r) => (r.id === row.id ? { ...r, ...row, preview: r.preview } : r));
  qc.setQueryData(dbKeys.row(dataId, row.id), row);
}

export function useDatabaseActions(db: DatabaseDto) {
  const qc = useQueryClient();
  const onError = (err: unknown) => toast.error(errorMessage(err));
  const refreshDb = () => void qc.invalidateQueries({ queryKey: ['db'] });
  const refreshRows = () => invalidateRows(qc, db.dataId);

  const createRow = useMutation({
    mutationFn: (input: CreateRowInput) => apiPost<RowDto>(`/databases/${db.id}/rows`, input),
    onSuccess: refreshRows,
    onError,
  });
  const updateRow = useMutation({
    mutationFn: ({
      rowId,
      ...input
    }: {
      rowId: string;
      title?: string;
      values?: Record<string, unknown>;
    }) => apiPatch<RowDto>(`/databases/${db.id}/rows/${rowId}/properties`, input),
    onMutate: ({ rowId, title, values }) => {
      // Optimistisch: Wert sofort anzeigen, bei Fehler neu laden
      mapRowsInCache(qc, db.dataId, (r) =>
        r.id === rowId
          ? {
              ...r,
              ...(title !== undefined ? { title } : {}),
              values: { ...r.values, ...(values as RowDto['values']) },
            }
          : r,
      );
    },
    onSuccess: (row, vars) => {
      patchRowInCache(qc, db.dataId, row);
      // Filter, Sortierung und Berechnungen können sich geändert haben
      void qc.invalidateQueries({ queryKey: dbKeys.calc(db.dataId) });
      void qc.invalidateQueries({ queryKey: dbKeys.rows(db.dataId) });
      if (vars.title !== undefined) void qc.invalidateQueries({ queryKey: qk.page(row.id) });
    },
    onError: (err) => {
      onError(err);
      refreshRows();
    },
  });
  const trashRows = useMutation({
    mutationFn: (rowIds: string[]) => apiPost(`/databases/${db.id}/rows/trash`, { rowIds }),
    onSuccess: refreshRows,
    onError,
  });
  const moveRow = useMutation({
    mutationFn: ({ rowId, ...input }: { rowId: string; afterId?: string; beforeId?: string }) =>
      apiPost<RowDto>(`/databases/${db.id}/rows/${rowId}/move`, input),
    onSuccess: refreshRows,
    onError,
  });
  const createProperty = useMutation({
    mutationFn: (input: CreatePropertyInput) =>
      apiPost<PropertyDto>(`/databases/${db.id}/properties`, input),
    onSuccess: () => {
      refreshDb();
      refreshRows();
    },
    onError,
  });
  const updateProperty = useMutation({
    mutationFn: ({ id, ...input }: UpdatePropertyInput & { id: string }) =>
      apiPatch<PropertyDto>(`/databases/${db.id}/properties/${id}`, input),
    onSuccess: (prop) => {
      qc.setQueryData<DatabaseDto>(dbKeys.db(db.id), (old) =>
        old
          ? { ...old, properties: old.properties.map((p) => (p.id === prop.id ? prop : p)) }
          : old,
      );
      refreshDb();
      refreshRows();
    },
    onError,
  });
  const deleteProperty = useMutation({
    mutationFn: (id: string) => apiDelete(`/databases/${db.id}/properties/${id}`),
    onSuccess: () => {
      refreshDb();
      refreshRows();
    },
    onError,
  });
  const undoConversion = useMutation({
    mutationFn: (id: string) =>
      apiPost<PropertyDto>(`/databases/${db.id}/properties/${id}/undo-conversion`),
    onSuccess: () => {
      refreshDb();
      refreshRows();
    },
    onError,
  });
  const createView = useMutation({
    mutationFn: (input: {
      name: string;
      type?: ViewDto['type'];
      duplicateOf?: string;
      afterId?: string;
    }) => apiPost<ViewDto>(`/databases/${db.id}/views`, input),
    onSuccess: refreshDb,
    onError,
  });
  const updateView = useMutation({
    mutationKey: ['updateView', db.id],
    // Nacheinander senden: sonst können schnelle Teil-Updates (z. B. Sortierung hinzufügen und
    // gleich die Richtung ändern) vertauscht beim Server ankommen und die ältere gewinnt
    scope: { id: `updateView:${db.id}` },
    mutationFn: ({ id, ...input }: UpdateViewInput & { id: string }) =>
      apiPatch<ViewDto>(`/databases/${db.id}/views/${id}`, input),
    onMutate: ({ id, config, name, type }) => {
      qc.setQueryData<DatabaseDto>(dbKeys.db(db.id), (old) =>
        old
          ? {
              ...old,
              views: old.views.map((v) =>
                v.id === id
                  ? {
                      ...v,
                      ...(name ? { name } : {}),
                      ...(type ? { type } : {}),
                      config: { ...v.config, ...(config as Partial<ViewDto['config']>) },
                    }
                  : v,
              ),
            }
          : old,
      );
    },
    onSuccess: (view) => {
      // Sind schon neuere Änderungen unterwegs, nicht mit dieser (älteren) Antwort überschreiben;
      // die zuletzt abgeschlossene Änderung setzt den endgültigen Stand.
      if (qc.isMutating({ mutationKey: ['updateView', db.id] }) > 1) return;
      qc.setQueryData<DatabaseDto>(dbKeys.db(db.id), (old) =>
        old ? { ...old, views: old.views.map((v) => (v.id === view.id ? view : v)) } : old,
      );
      if (view) refreshRows();
    },
    onError: (err) => {
      onError(err);
      refreshDb();
    },
  });
  const deleteView = useMutation({
    mutationFn: (id: string) => apiDelete(`/databases/${db.id}/views/${id}`),
    onSuccess: refreshDb,
    onError,
  });
  return {
    refreshDb: () => qc.invalidateQueries({ queryKey: ['db'] }),
    createRow,
    updateRow,
    trashRows,
    moveRow,
    createProperty,
    updateProperty,
    deleteProperty,
    undoConversion,
    createView,
    updateView,
    deleteView,
  };
}

export type DatabaseActions = ReturnType<typeof useDatabaseActions>;

/** Alle geladenen Zeilen einer Ansicht als flache Liste. */
export function useFlatRows(data: InfiniteData<RowQueryResultDto> | undefined) {
  return useMemo(() => {
    const rows = data?.pages.flatMap((p) => p.rows) ?? [];
    const total = data?.pages[0]?.total ?? rows.length;
    return { rows, total };
  }, [data]);
}

export type { FilterGroup, SortSpec };
