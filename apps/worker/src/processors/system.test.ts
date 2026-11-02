import { WORKER_HEARTBEAT_KEY } from '@jotion/shared';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { createSystemProcessor } from './system';

describe('System-Processor', () => {
  it('schreibt beim Heartbeat-Job einen Zeitstempel mit TTL', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    const run = createSystemProcessor({ set } as unknown as Redis);
    await run({ name: 'heartbeat' } as Job);
    expect(set).toHaveBeenCalledWith(
      WORKER_HEARTBEAT_KEY,
      expect.any(String),
      'PX',
      expect.any(Number),
    );
    expect(JSON.parse(set.mock.calls[0]![1] as string).at).toBeTypeOf('number');
  });

  it('lehnt unbekannte Jobs ab', async () => {
    const run = createSystemProcessor({} as Redis);
    await expect(run({ name: 'unbekannt' } as Job)).rejects.toThrow(/Unbekannter Job/);
  });
});
