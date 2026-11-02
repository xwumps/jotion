import { describe, expect, it } from 'vitest';
import { aggregateHealth, runCheck } from './health';

describe('health', () => {
  it('meldet error, sobald ein Check fehlschlägt', () => {
    const r = aggregateHealth('api', '0.1.0', { db: { status: 'ok' }, redis: { status: 'error' } });
    expect(r.status).toBe('error');
  });

  it('fängt Fehler und Timeouts ab', async () => {
    expect((await runCheck(() => Promise.reject(new Error('down')))).error).toBe('down');
    const slow = await runCheck(() => new Promise((r) => setTimeout(r, 200)), 20);
    expect(slow.status).toBe('error');
    expect(slow.error).toMatch(/Timeout/);
    expect((await runCheck(() => Promise.resolve())).status).toBe('ok');
  });
});
