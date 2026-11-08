import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/request-context';
import { UUID } from '../common/uuid.pipe';
import { TemplatesService } from './templates.service';

/** Phase 9: Vorlagen-Galerie, eigene Vorlagen, Zeilen-Vorlagen von Datenbanken. */
@Controller()
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get('workspaces/:id/templates')
  gallery(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.templates.gallery(u, id);
  }

  @Post('workspaces/:id/templates/use')
  use(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.templates.use(u, id, body);
  }

  @Put('pages/:id/template')
  setTemplate(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.templates.setTemplate(u, id, body);
  }

  @Get('databases/:id/templates')
  rowTemplates(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.templates.rowTemplates(u, id);
  }

  @Post('databases/:id/templates')
  createRowTemplate(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Body() body: unknown,
  ) {
    return this.templates.createRowTemplate(u, id, body);
  }

  @Patch('databases/:id/templates/:tid')
  updateRowTemplate(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Param('tid', UUID) tid: string,
    @Body() body: unknown,
  ) {
    return this.templates.updateRowTemplate(u, id, tid, body);
  }

  @Delete('databases/:id/templates/:tid')
  @HttpCode(204)
  async deleteRowTemplate(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Param('tid', UUID) tid: string,
  ) {
    await this.templates.deleteRowTemplate(u, id, tid);
  }
}
