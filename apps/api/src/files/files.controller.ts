import { Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { MAX_IMAGE_UPLOAD_BYTES } from '@jotion/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../common/errors';
import { CurrentUser, type AuthUser } from '../common/request-context';
import { UUID } from '../common/uuid.pipe';
import { FilesService } from './files.service';

@Controller()
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('workspaces/:id/files')
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID) workspaceId: string,
    @Req() req: FastifyRequest,
  ) {
    if (!req.isMultipart()) throw new AppError('bad_request', 'multipart/form-data erwartet');
    const part = await req.file({ limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES, files: 1 } });
    if (!part) throw new AppError('bad_request', 'Keine Datei');
    const data = await part.toBuffer();
    return this.files.uploadImage(user, workspaceId, data, part.filename);
  }

  /** Allgemeiner Upload (Bild, Video, Audio, PDF, beliebige Datei) */
  @Post('workspaces/:id/uploads')
  async uploadAny(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID) workspaceId: string,
    @Req() req: FastifyRequest,
  ) {
    if (!req.isMultipart()) throw new AppError('bad_request', 'multipart/form-data erwartet');
    const part = await req.file({
      limits: { fileSize: this.files.maxUploadBytes + 1, files: 1 },
      throwFileSizeLimit: false,
    });
    if (!part) throw new AppError('bad_request', 'Keine Datei');
    return this.files.uploadAny(user, workspaceId, part.file, part.filename);
  }

  @Get('files/:id')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID) id: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Query('inline') inlineParam?: string,
    @Query('download') downloadParam?: string,
  ) {
    const meta = await this.files.meta(user, id);
    const range = parseRange(req.headers.range, meta.size);
    if (range === 'invalid') {
      return reply.status(416).header('Content-Range', `bytes */${meta.size}`).send();
    }
    const f = await this.files.open(user, id, range ?? undefined);
    const image = INLINE_IMAGES.has(f.mime);
    const pdfInline = f.mime === 'application/pdf' && inlineParam === '1';
    // Nur neu kodierte Bilder und ausdrücklich angefragte PDFs inline, alles andere als Download.
    // Video und Audio spielen im Player trotzdem ab (Medienelemente ignorieren die Disposition).
    const inline = (image || pdfInline) && downloadParam !== '1';
    const disposition = `${inline ? 'inline' : 'attachment'}${contentDispositionName(f.name)}`;
    reply
      .header('Content-Type', f.mime)
      .header('Content-Disposition', disposition)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Accept-Ranges', 'bytes')
      .header(
        'Content-Security-Policy',
        pdfInline
          ? "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'self'"
          : "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      )
      // Datei-IDs sind unveränderlich
      .header('Cache-Control', 'private, max-age=31536000, immutable');
    if (range) {
      reply
        .status(206)
        .header('Content-Range', `bytes ${range.start}-${range.end}/${f.size}`)
        .header('Content-Length', range.end - range.start + 1);
    } else reply.header('Content-Length', f.size);
    return reply.send(f.stream);
  }
}

const INLINE_IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Einzelner Byte-Bereich ("bytes=0-99", "bytes=100-", "bytes=-50"). Mehrere Bereiche: ganze Datei. */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}

function contentDispositionName(name: string | null): string {
  if (!name) return '';
  // eslint-disable-next-line no-control-regex -- Steuerzeichen aus Dateinamen entfernen
  const clean = name.replace(/[\x00-\x1f\x7f"\\/]/g, '_').slice(0, 200);
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_');
  return `; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}
