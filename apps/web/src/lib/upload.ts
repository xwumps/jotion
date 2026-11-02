import type { FileDto } from '@jotion/shared';
import { api } from './api-client';

export function uploadImage(workspaceId: string, file: File): Promise<FileDto> {
  const form = new FormData();
  form.append('file', file);
  return api<FileDto>(`/workspaces/${workspaceId}/files`, { method: 'POST', body: form });
}
