import pino from 'pino';

export const logger = pino({
  name: 'worker',
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: ['*.password', '*.secret', '*.token', '*.apiKey'], censor: '[redacted]' },
  ...(process.env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
    : {}),
});
