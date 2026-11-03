'use client';

import type {
  FavoriteDto,
  MovePageInput,
  PageCover,
  PageDto,
  PageIcon,
  PageScope,
  PageSettings,
  PageTreeNodeDto,
  RealtimeEvent,
  RecentPageDto,
} from '@jotion/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from './api-client';
import { pageHref } from './format';
import { qk } from './query-keys';

export interface Sidebar {
  private: PageTreeNodeDto[];
  team: PageTreeNodeDto[];
}

export const useSidebar = (ws: string) =>
  useQuery({
    queryKey: qk.sidebar(ws),
    queryFn: () => apiGet<Sidebar>(`/workspaces/${ws}/sidebar`),
  });
export const useChildren = (pageId: string, enabled: boolean) =>
  useQuery({
    queryKey: qk.children(pageId),
    queryFn: () => apiGet<PageTreeNodeDto[]>(`/pages/${pageId}/children`),
    enabled,
  });
export const usePage = (pageId: string) =>
  useQuery({ queryKey: qk.page(pageId), queryFn: () => apiGet<PageDto>(`/pages/${pageId}`) });
export const useFavorites = (ws: string) =>
  useQuery({
    queryKey: qk.favorites(ws),
    queryFn: () => apiGet<FavoriteDto[]>(`/workspaces/${ws}/favorites`),
  });
export const useRecent = (ws: string) =>
  useQuery({
    queryKey: qk.recent(ws),
    queryFn: () => apiGet<RecentPageDto[]>(`/workspaces/${ws}/recent`),
  });

/** Nach Strukturänderungen: Baum, Favoriten, Papierkorb neu laden. */
export function invalidateTree(qc: QueryClient, ws: string): void {
  void qc.invalidateQueries({ queryKey: qk.sidebar(ws) });
  void qc.invalidateQueries({ queryKey: ['children'] });
  void qc.invalidateQueries({ queryKey: qk.favorites(ws) });
  void qc.invalidateQueries({ queryKey: qk.recent(ws) });
  void qc.invalidateQueries({ queryKey: qk.trash(ws) });
  void qc.invalidateQueries({ queryKey: qk.archive(ws) });
}

export function usePageActions(ws: string) {
  const qc = useQueryClient();
  const router = useRouter();
  const onError = (err: unknown) => toast.error(errorMessage(err));
  const done = (page?: PageDto) => {
    invalidateTree(qc, ws);
    if (page) qc.setQueryData(qk.page(page.id), page);
  };

  const create = useMutation({
    mutationFn: (input: { parentId?: string | null; scope?: PageScope; title?: string }) =>
      apiPost<PageDto>(`/workspaces/${ws}/pages`, input),
    onSuccess: (page) => {
      done(page);
      router.push(pageHref(ws, page.id));
    },
    onError,
  });
  const update = useMutation({
    mutationFn: ({
      id,
      ...input
    }: {
      id: string;
      title?: string;
      icon?: PageIcon | null;
      cover?: PageCover | null;
      settings?: PageSettings;
    }) => apiPatch<PageDto>(`/pages/${id}`, input),
    onSuccess: (page) => {
      qc.setQueryData(qk.page(page.id), page);
      // Titel und Icon erscheinen in Sidebar und Breadcrumbs
      void qc.invalidateQueries({ queryKey: qk.sidebar(ws) });
      void qc.invalidateQueries({ queryKey: ['children'] });
      void qc.invalidateQueries({ queryKey: qk.favorites(ws) });
    },
    onError,
  });
  const move = useMutation({
    mutationFn: ({ id, ...input }: MovePageInput & { id: string }) =>
      apiPost<PageDto>(`/pages/${id}/move`, input),
    onSuccess: done,
    onError,
  });
  const trash = useMutation({
    mutationFn: (id: string) => apiDelete(`/pages/${id}`),
    onSuccess: () => done(),
    onError,
  });
  const restore = useMutation({
    mutationFn: (id: string) => apiPost<PageDto>(`/pages/${id}/restore`),
    onSuccess: done,
    onError,
  });
  const deletePermanently = useMutation({
    mutationFn: (id: string) => apiDelete(`/pages/${id}/permanent`),
    onSuccess: () => done(),
    onError,
  });
  const archive = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      apiPost<PageDto>(`/pages/${id}/${archived ? 'archive' : 'unarchive'}`),
    onSuccess: done,
    onError,
  });
  const favorite = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) =>
      on ? apiPost(`/pages/${id}/favorite`) : apiDelete(`/pages/${id}/favorite`),
    onSuccess: (_d, { id }) => {
      void qc.invalidateQueries({ queryKey: qk.favorites(ws) });
      void qc.invalidateQueries({ queryKey: qk.page(id) });
    },
    onError,
  });
  return { create, update, move, trash, restore, deletePermanently, archive, favorite };
}

/** Live-Aktualisierung über Server-Sent Events. */
export function useRealtime(ws: string): void {
  const qc = useQueryClient();
  const router = useRouter();
  useEffect(() => {
    const source = new EventSource(`/api/workspaces/${ws}/events`);
    source.addEventListener('change', (msg) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse((msg as MessageEvent<string>).data) as RealtimeEvent;
      } catch {
        return;
      }
      if (event.type.startsWith('page.')) {
        invalidateTree(qc, ws);
        void qc.invalidateQueries({ queryKey: qk.page(event.entityId) });
      } else if (event.type === 'members.changed') {
        void qc.invalidateQueries({ queryKey: qk.members(ws) });
      } else if (event.type === 'workspace.updated') {
        // Workspace-Name kommt serverseitig aus /auth/me
        router.refresh();
      }
    });
    return () => source.close();
  }, [qc, ws, router]);
}
