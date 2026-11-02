import type { ApiError, ErrorCode } from '@jotion/shared';

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Browser-Aufrufe der API (gleicher Origin, Cookie-Session). */
export async function api<T = unknown>(
  path: string,
  options: { method?: Method; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers:
      options.body !== undefined && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : undefined,
    body:
      options.body instanceof FormData
        ? options.body
        : options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (data as ApiError | null)?.error;
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiClientError(
      res.status,
      err?.code ?? 'internal',
      err?.message ?? 'Unbekannter Fehler',
      err?.details,
    );
  }
  return data as T;
}

export const apiGet = <T>(path: string) => api<T>(path);
export const apiPost = <T>(path: string, body: unknown = {}) =>
  api<T>(path, { method: 'POST', body });
export const apiPatch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const apiDelete = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export function errorMessage(err: unknown): string {
  return err instanceof ApiClientError ? err.message : 'Etwas ist schiefgelaufen';
}
