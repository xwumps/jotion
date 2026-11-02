import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv, serverEnvSchema } from './env';

const key = Buffer.alloc(32, 7).toString('base64');
const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://:p@localhost:6379',
  JOTION_PUBLIC_URL: 'http://localhost:8080',
  JOTION_MASTER_KEY: key,
  AUTH_SECRET: key,
};

describe('parseEnv', () => {
  it('akzeptiert gültige Konfiguration und setzt Defaults', () => {
    const env = parseEnv(serverEnvSchema, valid);
    expect(env.API_PORT).toBe(4000);
    expect(env.JOTION_DEFAULT_LOCALE).toBe('de');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('lehnt zu kurze Schlüssel ab, ohne den Wert auszugeben', () => {
    const secret = Buffer.alloc(16, 1).toString('base64');
    try {
      parseEnv(serverEnvSchema, { ...valid, JOTION_MASTER_KEY: secret });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      expect((err as Error).message).toContain('JOTION_MASTER_KEY');
      expect((err as Error).message).not.toContain(secret);
    }
  });

  it('behandelt leere Strings als nicht gesetzt', () => {
    expect(() => parseEnv(serverEnvSchema, { ...valid, AUTH_SECRET: '' })).toThrow(/AUTH_SECRET/);
  });

  it('liest Werte aus *_FILE (Docker Secrets)', () => {
    const { AUTH_SECRET: _omit, ...rest } = valid;
    const env = parseEnv(
      serverEnvSchema,
      { ...rest, AUTH_SECRET_FILE: '/run/secrets/auth' },
      (p) => (p === '/run/secrets/auth' ? `${key}\n` : ''),
    );
    expect(env.AUTH_SECRET).toBe(key);
  });

  it('lehnt falsche Datenbank-URL ab', () => {
    expect(() =>
      parseEnv(serverEnvSchema, { ...valid, DATABASE_URL: 'mysql://localhost/db' }),
    ).toThrow(/DATABASE_URL/);
  });
});
