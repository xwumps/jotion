import 'server-only';
import type { MeDto, SetupStatusDto } from '@jotion/shared';
import { cookies } from 'next/headers';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/** Serverseitiger API-Aufruf mit dem Session-Cookie des Browsers. */
async function serverFetch(path: string): Promise<Response | null> {
  const cookie = (await cookies()).toString();
  try {
    return await fetch(`${API_URL}/api${path}`, {
      headers: cookie ? { cookie } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return null;
  }
}

export async function getMe(): Promise<MeDto | null> {
  const res = await serverFetch('/auth/me');
  return res?.ok ? ((await res.json()) as MeDto) : null;
}

export async function getSetupStatus(): Promise<SetupStatusDto | null> {
  const res = await serverFetch('/auth/setup-status');
  return res?.ok ? ((await res.json()) as SetupStatusDto) : null;
}
