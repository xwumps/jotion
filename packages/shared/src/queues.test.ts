import { describe, expect, it } from 'vitest';
import { isHeartbeatFresh, parseHeartbeat } from './queues';

describe('worker heartbeat', () => {
  it('erkennt frische und veraltete Heartbeats', () => {
    const now = 1_000_000;
    expect(isHeartbeatFresh({ at: now - 1000, pid: 1, version: 'x' }, now)).toBe(true);
    expect(isHeartbeatFresh({ at: now - 120_000, pid: 1, version: 'x' }, now)).toBe(false);
    expect(isHeartbeatFresh(null, now)).toBe(false);
  });

  it('parst robust', () => {
    expect(parseHeartbeat(null)).toBeNull();
    expect(parseHeartbeat('kaputt')).toBeNull();
    expect(parseHeartbeat('{"foo":1}')).toBeNull();
    expect(parseHeartbeat('{"at":5}')).toEqual({ at: 5, pid: 0, version: '' });
  });
});
