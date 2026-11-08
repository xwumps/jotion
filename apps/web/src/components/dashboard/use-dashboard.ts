'use client';

import type { AgendaDto, DashboardDto, DashboardScope, Widget } from '@jotion/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiGet, apiPut, errorMessage } from '@/lib/api-client';
import { timeZone } from '../database/use-database';

export const dashboardKey = (ws: string, scope: DashboardScope) =>
  ['dashboard', ws, scope] as const;

export const useDashboard = (ws: string, scope: DashboardScope) =>
  useQuery({
    queryKey: dashboardKey(ws, scope),
    queryFn: () => apiGet<DashboardDto>(`/workspaces/${ws}/dashboard?scope=${scope}`),
  });

export function useSaveDashboard(ws: string, scope: DashboardScope) {
  const qc = useQueryClient();
  return useMutation({
    // Nacheinander speichern, damit ein älterer Stand nie einen neueren überschreibt
    scope: { id: `dashboard:${ws}:${scope}` },
    mutationFn: (widgets: Widget[]) =>
      apiPut<DashboardDto>(`/workspaces/${ws}/dashboard?scope=${scope}`, { widgets }),
    onMutate: (widgets) =>
      qc.setQueryData<DashboardDto>(dashboardKey(ws, scope), (old) =>
        old ? { ...old, widgets, isDefault: false } : old,
      ),
    onError: (err) => {
      toast.error(errorMessage(err));
      void qc.invalidateQueries({ queryKey: dashboardKey(ws, scope) });
    },
  });
}

/** Anstehend und überfällig über alle Datenbanken (lädt bei Änderungen an Datenbanken neu). */
export const useAgenda = (ws: string, days: number) =>
  useQuery({
    queryKey: ['agenda', ws, days],
    queryFn: () =>
      apiGet<AgendaDto>(
        `/workspaces/${ws}/agenda?days=${days}&tz=${encodeURIComponent(timeZone())}`,
      ),
    staleTime: 30_000,
  });
