import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { DASHBOARD_SCOPES, type DashboardScope } from '@jotion/shared';
import { CurrentUser, type AuthUser } from '../common/request-context';
import { UUID } from '../common/uuid.pipe';
import { DashboardService } from './dashboard.service';

const scopeOf = (s?: string): DashboardScope =>
  (DASHBOARD_SCOPES as readonly string[]).includes(s ?? '') ? (s as DashboardScope) : 'personal';

/** Phase 7: Dashboard der Startseite und Agenda über alle Datenbanken. */
@Controller('workspaces/:id')
export class DashboardController {
  constructor(private readonly dashboards: DashboardService) {}

  @Get('dashboard')
  get(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Query('scope') scope?: string) {
    return this.dashboards.get(u, id, scopeOf(scope));
  }

  @Put('dashboard')
  save(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Body() body: unknown,
    @Query('scope') scope?: string,
  ) {
    return this.dashboards.save(u, id, scopeOf(scope), body);
  }

  @Get('agenda')
  agenda(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Query('days') days?: string,
    @Query('tz') tz?: string,
  ) {
    return this.dashboards.agenda(
      u,
      id,
      Number(days) || 14,
      typeof tz === 'string' ? tz : undefined,
    );
  }
}
