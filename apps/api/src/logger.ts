import type { Params } from 'nestjs-pino';

/** Felder, die niemals im Log landen dürfen. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.secret',
  '*.token',
  '*.apiKey',
];

export function loggerOptions(): Params {
  const pretty = process.env.NODE_ENV === 'development';
  return {
    pinoHttp: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      // Healthchecks nicht bei jedem Aufruf loggen
      autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false },
      ...(pretty ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
    },
  };
}
