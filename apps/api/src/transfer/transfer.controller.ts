import { Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../common/errors';
import { CurrentUser, type AuthUser } from '../common/request-context';
import { UUID } from '../common/uuid.pipe';
import { FilesService } from '../files/files.service';
import { TransferService } from './transfer.service';

const attachment = (name: string) =>
  `attachment; filename="${name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/** Phase 12: Import (Markdown, CSV, Notion-ZIP) und Export (Markdown, HTML, CSV). */
@Controller()
export class TransferController {
  constructor(
    private readonly transfer: TransferService,
    private readonly files: FilesService,
  ) {}

  @Post('workspaces/:id/import')
  @HttpCode(201)
  async import(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) ws: string,
    @Query('scope') scope: string | undefined,
    @Query('parentId') parentId: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    if (!req.isMultipart()) throw new AppError('bad_request', 'multipart/form-data erwartet');
    const part = await req.file({
      limits: { fileSize: this.files.maxUploadBytes + 1, files: 1 },
      throwFileSizeLimit: false,
    });
    if (!part) throw new AppError('bad_request', 'Keine Datei');
    const data = await part.toBuffer();
    if (data.length > this.files.maxUploadBytes)
      throw new AppError('payload_too_large', 'Datei ist zu groß');
    const parent = parentId && /^[0-9a-f-]{36}$/i.test(parentId) ? parentId : null;
    return this.transfer.import(u, ws, part.filename || 'import', data, {
      scope: scope === 'PRIVATE' ? 'PRIVATE' : 'TEAM',
      parentId: parent,
    });
  }

  @Get('pages/:id/export')
  async exportPage(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Query('format') format: string | undefined,
    @Res() res: FastifyReply,
  ) {
    const { name, data } = await this.transfer.exportPage(
      u,
      id,
      format === 'html' ? 'html' : 'markdown',
    );
    return res
      .header('content-type', 'application/zip')
      .header('content-disposition', attachment(name))
      .header('cache-control', 'no-store')
      .send(data);
  }

  @Get('databases/:id/export.csv')
  async exportCsv(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Res() res: FastifyReply,
  ) {
    const csv = await this.transfer.databaseCsv(u, id);
    return res
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', attachment('export.csv'))
      .header('cache-control', 'no-store')
      .send(csv);
  }
}
