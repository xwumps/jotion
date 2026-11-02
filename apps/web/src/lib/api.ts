import 'server-only';
import type { HealthReport } from '@jotion/shared';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/** Systemstatus von der API. Liefert null, wenn die API nicht erreichbar ist. */
export async function fetchSystemHealth(): Promise<HealthReport | null> {
  try {
    const res = await fetch(`${API_URL}/api/health/system`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    // 503 liefert ebenfalls einen gültigen Report mit Fehlerdetails
    if (!res.ok && res.status !== 503) return null;
    return (await res.json()) as HealthReport;
  } catch {
    return null;
  }
}
