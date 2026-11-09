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
  /** Phase 12: Sicherungen (gemeinsames Volume mit dem Backup-Dienst) */
  JOTION_BACKUP_DIR: z.string().min(1).default('/data/backups'),
  /** Phase 12: Bearer-Token für /api/metrics (Prometheus); leer = Endpunkt aus */
  JOTION_METRICS_TOKEN: z.string().default(''),
  /** Phase 12.2: Admin-Bereich fragt neue Releases bei GitHub ab (false = nie) */
  JOTION_UPDATE_CHECK: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Repository für die Update-Prüfung (owner/name) */
  JOTION_UPDATE_REPO: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/, 'owner/name')
    .default('xwumps/jotion'),
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
  /** Phase 3: Höchstgröße für allgemeine Datei-Uploads in MB (Bilder bleiben bei 10 MB) */
  JOTION_MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(2048).default(100),
  /**
   * Phase 3: Hosts oder IP-Bereiche (CIDR), die serverseitige Abrufe trotz privater Adresse
   * erreichen dürfen (kommagetrennt), z. B. ein intern gehostetes Wiki. Standard: keine.
   */
  JOTION_SSRF_ALLOWLIST: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim().toLowerCase())
        .filter(Boolean),
    ),
  /**
   * Phase 11: OAuth-Apps für Google, Microsoft und Dropbox. Der Admin registriert eine eigene App
   * beim Anbieter; Rückleitung: <JOTION_PUBLIC_URL>/api/integrations/oauth/callback.
   * Ohne Client-ID ist der Anbieter in der Oberfläche nicht wählbar.
   */
  JOTION_GOOGLE_CLIENT_ID: z.string().default(''),
  JOTION_GOOGLE_CLIENT_SECRET: z.string().default(''),
  JOTION_MICROSOFT_CLIENT_ID: z.string().default(''),
  JOTION_MICROSOFT_CLIENT_SECRET: z.string().default(''),
  /** Mandant: "common" (private und Organisationskonten), "organizations" oder eine Mandanten-ID */
  JOTION_MICROSOFT_TENANT: z
    .string()
    .default('common')
    .refine((v) => /^[a-zA-Z0-9.-]{1,100}$/.test(v), 'ungültiger Mandant'),
  JOTION_DROPBOX_CLIENT_ID: z.string().default(''),
  /** Optional: Dropbox-Apps mit PKCE brauchen kein Secret */
  JOTION_DROPBOX_CLIENT_SECRET: z.string().default(''),
  /**
   * Phase 11, nur Tests: Basis-URLs der Dienste als JSON (z. B. {"google":"http://127.0.0.1:9000/google"}),
   * auch "oauth:<anbieter>:token" und "oauth:<anbieter>:authorize". In production ignoriert.
   */
  JOTION_INTEGRATION_ENDPOINTS: z
    .string()
    .default('')
    .transform((v, c) => {
      if (!v.trim()) return {} as Record<string, string>;
      try {
        const o = JSON.parse(v) as unknown;
        if (o && typeof o === 'object' && !Array.isArray(o))
          return Object.fromEntries(
            Object.entries(o).filter(([, x]) => typeof x === 'string'),
          ) as Record<string, string>;
      } catch {
        /* unten */
      }
      c.addIssue({ code: 'custom', message: 'muss ein JSON-Objekt sein' });
      return z.NEVER;
    }),
  /** Phase 6: Zeitzone für Datumsfunktionen in Formeln (now(), today(), formatDate) */
  JOTION_TIMEZONE: z
    .string()
    .default('Europe/Berlin')
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'muss eine IANA-Zeitzone sein'),
  /**
   * Phase 6: Abhängige Berechnungen direkt in der API statt im Worker weiterreichen
   * (für Tests ohne Worker). Standard: Worker.
   */
  JOTION_COMPUTE_INLINE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Phase 8: Frühere Master-Schlüssel (kommagetrennt, Base64) zum Entschlüsseln nach einer
   * Schlüsselrotation. Neue Daten werden immer mit JOTION_MASTER_KEY verschlüsselt.
   */
  JOTION_MASTER_KEY_PREVIOUS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    )
    .refine((keys) => keys.every((k) => Buffer.from(k, 'base64').length === 32), {
      message: 'muss aus 32-Byte-Schlüsseln in Base64 bestehen',
    }),
  /** Phase 8: Integrationen direkt in der API synchronisieren statt im Worker (für Tests) */
  JOTION_SYNC_INLINE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Phase 9: Automatisierungen direkt ausführen statt über die Queue (für Tests) */
  JOTION_AUTOMATIONS_INLINE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
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
