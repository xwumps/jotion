import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/request-context';
import { UUID } from '../common/uuid.pipe';
import { AutomationsService } from './automations.service';

/** Phase 9: Automatisierungen, Ausführungsprotokoll, Buttons. */
@Controller()
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Get('workspaces/:id/automations')
  list(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Query('databaseId') databaseId?: string,
  ) {
    return this.automations.list(
      u,
      id,
      typeof databaseId === 'string' && databaseId ? databaseId : undefined,
    );
  }

  @Post('workspaces/:id/automations')
  create(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.automations.create(u, id, body);
  }

  @Get('automations/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.automations.get(u, id);
  }

  @Patch('automations/:id')
  update(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.automations.update(u, id, body);
  }

  @Delete('automations/:id')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    await this.automations.remove(u, id);
  }

  @Get('automations/:id/runs')
  runs(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.automations.runs(u, id);
  }

  @Post('automations/:id/run')
  @HttpCode(200)
  run(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.automations.clickBlockButton(u, id);
  }

  @Post('databases/:id/rows/:rowId/buttons/:propertyId')
  @HttpCode(200)
  click(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Param('rowId', UUID) rowId: string,
    @Param('propertyId', UUID) propertyId: string,
  ) {
    return this.automations.clickRowButton(u, id, rowId, propertyId);
  }
}
