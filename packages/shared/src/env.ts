import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { LOCALES } from './brand';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** 32-Byte-Schlüssel als Base64. */
const base64Key32 = z
  .string()
  .min(1, 'darf nicht leer sein')
  .refine((v) => {
    try {
      return Buffer.from(v, 'base64').length === 32;
    } catch {
      return false;
    }
  }, 'muss 32 Byte als Base64 sein (openssl rand -base64 32)');

const url = z.url();

/** Konfiguration für api und worker. */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DATABASE_URL: url.refine((v) => v.startsWith('postgres'), 'muss eine PostgreSQL-URL sein'),
  REDIS_URL: url.refine((v) => v.startsWith('redis'), 'muss eine Redis-URL sein'),
  JOTION_PUBLIC_URL: url,
  JOTION_DEFAULT_LOCALE: z.enum(LOCALES).default('de'),
  JOTION_MASTER_KEY: base64Key32,
  AUTH_SECRET: base64Key32,
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /** Verzeichnis für hochgeladene Dateien (Docker-Volume) */
  JOTION_FILES_DIR: z.string().min(1).default('/data/files'),
  /** Zusätzlich erlaubte Origins für schreibende Requests (kommagetrennt), z. B. Dev-Server */
  JOTION_ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
});
export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Ungültige Konfiguration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

/** Validiert Umgebungsvariablen. Unterstützt `<NAME>_FILE` für Docker Secrets. */
export function parseEnv<S extends z.ZodObject>(
  schema: S,
  source: NodeJS.ProcessEnv = process.env,
  readFile: (path: string) => string = defaultReadFile,
): z.infer<S> {
  const resolved: Record<string, string | undefined> = { ...source };
  for (const key of Object.keys(schema.shape)) {
    const filePath = source[`${key}_FILE`];
    if (!resolved[key] && filePath) resolved[key] = readFile(filePath).trim();
    if (resolved[key] === '') resolved[key] = undefined;
  }
  const result = schema.safeParse(resolved);
  if (!result.success) {
    // Werte niemals ausgeben, nur Schlüssel und Problem
    throw new EnvValidationError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}

function defaultReadFile(path: string): string {
  return readFileSync(path, 'utf8');
}
