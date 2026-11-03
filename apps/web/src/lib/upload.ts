import type { FileDto, UploadedFileDto } from '@jotion/shared';
import { api } from './api-client';

export function uploadImage(workspaceId: string, file: File): Promise<FileDto> {
  const form = new FormData();
  form.append('file', file);
  return api<FileDto>(`/workspaces/${workspaceId}/files`, { method: 'POST', body: form });
}

/** Allgemeiner Upload (Bild, Video, Audio, PDF, Datei). Der Server erkennt den Typ am Inhalt. */
export function uploadFile(
  workspaceId: string,
  file: Blob,
  name?: string,
): Promise<UploadedFileDto> {
  const form = new FormData();
  form.append('file', file, name ?? (file instanceof File ? file.name : 'datei'));
  return api<UploadedFileDto>(`/workspaces/${workspaceId}/uploads`, { method: 'POST', body: form });
}

/** data:-URL (z. B. aus eingefügtem HTML) in eine Datei umwandeln. */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob | null> {
  if (!/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(dataUrl)) return null;
  try {
    return await (await fetch(dataUrl)).blob();
  } catch {
    return null;
  }
}

export function formatBytes(n: number | null | undefined, locale: string): string {
  if (!n || n < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: i ? 1 : 0 }).format(v)} ${units[i]}`;
}
