import { Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
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

  @Get('files/:id')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID) id: string,
    @Res() reply: FastifyReply,
  ) {
    const f = await this.files.open(user, id);
    return (
      reply
        .header('Content-Type', f.mime)
        .header('Content-Length', f.size)
        .header('Content-Disposition', 'inline')
        .header('X-Content-Type-Options', 'nosniff')
        .header(
          'Content-Security-Policy',
          "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        )
        // Datei-IDs sind unveränderlich
        .header('Cache-Control', 'private, max-age=31536000, immutable')
        .send(f.stream)
    );
  }
}
