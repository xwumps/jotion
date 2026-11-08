import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  calculateSchema,
  chartQuerySchema,
  createDatabaseSchema,
  createPropertySchema,
  createRowSchema,
  createViewSchema,
  groupsQuerySchema,
  moveRowSchema,
  queryRowsSchema,
  trashRowsSchema,
  updatePropertySchema,
  updateRowSchema,
  updateViewSchema,
} from '@jotion/shared';
import { CurrentUser, type AuthUser } from '../common/request-context';
import { UUID } from '../common/uuid.pipe';
import { parse } from '../common/validation';
import { ChartsService } from './charts.service';
import { DatabasesService } from './databases.service';
import { RowsService } from './rows.service';

/** Datenbanken (Phase 4). Jede Route prüft Rechte über DatabaseAccessService/PermissionService. */
@Controller()
export class DatabasesController {
  constructor(
    private readonly dbs: DatabasesService,
    private readonly rows: RowsService,
    private readonly charts: ChartsService,
  ) {}

  @Post('workspaces/:id/databases')
  create(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.dbs.create(u, id, parse(createDatabaseSchema, body));
  }

  @Get('workspaces/:id/databases')
  search(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Query('q') q?: string) {
    return this.dbs.search(u, id, typeof q === 'string' ? q : '');
  }

  @Get('databases/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.dbs.get(u, id);
  }

  // ---------------------------------------------------------------- Properties

  @Post('databases/:id/properties')
  createProperty(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.dbs.createProperty(u, id, parse(createPropertySchema, body));
  }

  @Patch('databases/:id/properties/:pid')
  updateProperty(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Param('pid', UUID) pid: string,
    @Body() body: unknown,
  ) {
    return this.dbs.updateProperty(u, id, pid, parse(updatePropertySchema, body));
  }

  @Delete('databases/:id/properties/:pid')
  @HttpCode(204)
  deleteProperty(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Param('pid', UUID) pid: string,
  ) {
    return this.dbs.deleteProperty(u, id, pid);
  }

  @Post('databases/:id/properties/:pid/undo-conversion')
  @HttpCode(200)
  undoConversion(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Param('pid', UUID) pid: string,
  ) {
    return this.dbs.undoConversion(u, id, pid);
  }

  // ---------------------------------------------------------------- Ansichten

  @Post('databases/:id/views')
  createView(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.dbs.createView(u, id, parse(createViewSchema, body));
  }

  @Patch('databases/:id/views/:vid')
  updateView(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Param('vid', UUID) vid: string,
    @Body() body: unknown,
  ) {
    return this.dbs.updateView(u, id, vid, parse(updateViewSchema, body));
  }

  @Delete('databases/:id/views/:vid')
  @HttpCode(204)
  deleteView(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Param('vid', UUID) vid: string,
  ) {
    return this.dbs.deleteView(u, id, vid);
  }

  // ---------------------------------------------------------------- Zeilen

  @Post('databases/:id/query')
  @HttpCode(200)
  query(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.rows.query(u, id, parse(queryRowsSchema, body));
  }

  @Post('databases/:id/calculate')
  @HttpCode(200)
  calculate(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.rows.calculate(u, id, parse(calculateSchema, body));
  }

  @Post('databases/:id/chart')
  @HttpCode(200)
  chart(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.charts.data(u, id, parse(chartQuerySchema, body));
  }

  @Post('databases/:id/groups')
  @HttpCode(200)
  groups(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.rows.groups(u, id, parse(groupsQuerySchema, body));
  }

  @Post('databases/:id/rows')
  createRow(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.rows.create(u, id, parse(createRowSchema, body));
  }

  @Post('databases/:id/rows/trash')
  @HttpCode(200)
  trashRows(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.rows.trash(u, id, parse(trashRowsSchema, body));
  }

  @Get('databases/:id/rows/:rowId')
  getRow(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Param('rowId', UUID) rowId: string,
  ) {
    return this.rows.get(u, id, rowId);
  }

  @Patch('databases/:id/rows/:rowId/properties')
  updateRow(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Param('rowId', UUID) rowId: string,
    @Body() body: unknown,
  ) {
    return this.rows.update(u, id, rowId, parse(updateRowSchema, body));
  }

  @Post('databases/:id/rows/:rowId/move')
  @HttpCode(200)
  moveRow(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Param('rowId', UUID) rowId: string,
    @Body() body: unknown,
  ) {
    return this.rows.move(u, id, rowId, parse(moveRowSchema, body));
  }
}
