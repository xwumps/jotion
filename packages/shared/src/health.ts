export type HealthStatus = 'ok' | 'error';

export interface HealthCheckResult {
  status: HealthStatus;
  latencyMs?: number;
  error?: string;
}

export interface HealthReport {
  status: HealthStatus;
  service: string;
  version: string;
  checks: Record<string, HealthCheckResult>;
}

/** Gesamtstatus ist nur dann ok, wenn alle Einzelchecks ok sind. */
export function aggregateHealth(
  service: string,
  version: string,
  checks: Record<string, HealthCheckResult>,
): HealthReport {
  const status = Object.values(checks).every((c) => c.status === 'ok') ? 'ok' : 'error';
  return { status, service, version, checks };
}

/** Führt einen Check mit Zeitmessung und Timeout aus. Wirft nie. */
export async function runCheck(
  fn: () => Promise<unknown>,
  timeoutMs = 2000,
): Promise<HealthCheckResult> {
  const start = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout nach ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
    return { status: 'ok', latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      status: 'error',
      latencyMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
