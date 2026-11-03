import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@jotion/db';
import type { ApiError, ErrorCode } from '@jotion/shared';
import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from './errors';

/** Einheitliches Fehlerformat { error: { code, message, details? } } für alle Antworten. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const [status, body] = this.map(exception);
    if (status >= 500)
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    void reply.status(status).send(body);
  }

  private map(e: unknown): [number, ApiError] {
    const out = (
      status: number,
      code: ErrorCode,
      message: string,
      details?: unknown,
    ): [number, ApiError] => [
      status,
      { error: { code, message, ...(details !== undefined ? { details } : {}) } },
    ];

    if (e instanceof AppError) return out(e.status, e.code, e.message, e.details);
    if (e instanceof ZodError) {
      return out(
        422,
        'validation_failed',
        'Eingabe ungültig',
        e.issues.map((i) => ({ path: i.path, message: i.message })),
      );
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') return out(409, 'conflict', 'Eintrag existiert bereits');
      if (e.code === 'P2025') return out(404, 'not_found', 'Nicht gefunden');
    }
    // Trigger-Fehler aus PostgreSQL (z. B. Zyklus im Seitenbaum)
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('own subtree') || msg.includes('own parent')) {
      return out(409, 'cycle', 'Eine Seite kann nicht in sich selbst verschoben werden');
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const code: ErrorCode =
        status === 404
          ? 'not_found'
          : status === 413
            ? 'payload_too_large'
            : status === 415
              ? 'unsupported_media_type'
              : status < 500
                ? 'bad_request'
                : 'internal';
      return out(status, code, status === 404 ? 'Nicht gefunden' : e.message);
    }
    const fastifyCode = (e as { code?: string }).code;
    if (fastifyCode === 'FST_REQ_FILE_TOO_LARGE' || fastifyCode === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return out(413, 'payload_too_large', 'Datei zu groß');
    }
    return out(500, 'internal', 'Interner Fehler');
  }
}
