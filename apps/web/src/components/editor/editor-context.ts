'use client';

import { createContext, useContext } from 'react';
import { useParams } from 'next/navigation';

/** Workspace und Seite für Node-Views (Editor und Druckansicht haben unterschiedliche Routen). */
export const EditorPageContext = createContext<{ workspaceId: string; pageId: string } | null>(
  null,
);

export function useEditorPage(): { workspaceId: string; pageId: string } {
  const ctx = useContext(EditorPageContext);
  const params = useParams<{ workspaceId?: string; pageId?: string }>();
  return ctx ?? { workspaceId: params.workspaceId ?? '', pageId: params.pageId ?? '' };
}
