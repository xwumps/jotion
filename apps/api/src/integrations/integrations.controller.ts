import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/request-context';
import { UUID } from '../common/uuid.pipe';
import { IntegrationsService } from './integrations.service';

/** Phase 8: Einstellungen → Integrationen (Verbindungen des angemeldeten Nutzers). */
@Controller('workspaces/:id/integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.integrations.list(u, id);
  }

  @Get('connectors')
  connectors() {
    return this.integrations.connectors();
  }

  @Post('test')
  @HttpCode(200)
  test(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.integrations.test(u, id, body);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.integrations.create(u, id, body);
  }

  @Get(':cid')
  get(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Param('cid', UUID) cid: string) {
    return this.integrations.get(u, id, cid);
  }

  @Patch(':cid')
  update(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Param('cid', UUID) cid: string,
    @Body() body: unknown,
  ) {
    return this.integrations.update(u, id, cid, body);
  }

  @Delete(':cid')
  @HttpCode(204)
  async disconnect(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Param('cid', UUID) cid: string,
    @Query('rows') rows?: string,
  ) {
    await this.integrations.disconnect(u, id, cid, {
      rows: rows === 'archive' ? 'archive' : 'keep',
    });
  }

  @Post(':cid/test')
  @HttpCode(200)
  retest(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Param('cid', UUID) cid: string,
  ) {
    return this.integrations.retest(u, id, cid);
  }

  @Post(':cid/sync')
  @HttpCode(200)
  sync(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Param('cid', UUID) cid: string) {
    return this.integrations.sync(u, id, cid);
  }

  @Get(':cid/runs')
  runs(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Param('cid', UUID) cid: string) {
    return this.integrations.runs(u, id, cid);
  }

  @Get(':cid/conflicts')
  conflicts(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Param('cid', UUID) cid: string,
  ) {
    return this.integrations.conflicts(u, id, cid);
  }

  @Post(':cid/conflicts/:conflictId')
  @HttpCode(200)
  resolve(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Param('cid', UUID) cid: string,
    @Param('conflictId', UUID) conflictId: string,
    @Body() body: unknown,
  ) {
    return this.integrations.resolveConflict(u, id, cid, conflictId, body);
  }

  @Patch(':cid/sources/:sid')
  updateSource(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Param('cid', UUID) cid: string,
    @Param('sid', UUID) sid: string,
    @Body() body: unknown,
  ) {
    return this.integrations.updateSource(u, id, cid, sid, body);
  }

  @Get(':cid/sources/:sid/suggest')
  suggest(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Param('cid', UUID) cid: string,
    @Param('sid', UUID) sid: string,
    @Query('databaseId', UUID) databaseId: string,
  ) {
    return this.integrations.suggest(u, id, cid, sid, databaseId);
  }

  @Post(':cid/sources/:sid/database')
  createTarget(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Param('cid', UUID) cid: string,
    @Param('sid', UUID) sid: string,
    @Body() body: unknown,
  ) {
    return this.integrations.createTarget(u, id, cid, sid, body);
  }

  @Post(':cid/sources/:sid/preview')
  @HttpCode(200)
  preview(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Param('cid', UUID) cid: string,
    @Param('sid', UUID) sid: string,
    @Body() body: unknown,
  ) {
    return this.integrations.preview(u, id, cid, sid, body);
  }
}
