import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createPageSchema,
  movePageSchema,
  reorderFavoriteSchema,
  updatePageSchema,
} from '@jotion/shared';
import { CurrentUser, type AuthUser } from '../common/request-context';
import { UUID } from '../common/uuid.pipe';
import { parse } from '../common/validation';
import { PagesService } from './pages.service';
import { WorkspaceMoveService } from './workspace-move.service';

@Controller()
export class PagesController {
  constructor(
    private readonly pages: PagesService,
    private readonly moves: WorkspaceMoveService,
  ) {}

  @Get('workspaces/:id/sidebar')
  sidebar(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.pages.sidebar(u, id);
  }

  @Post('workspaces/:id/pages')
  create(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.pages.create(u, id, parse(createPageSchema, body));
  }

  @Post('pages/:id/synced-blocks')
  @HttpCode(201)
  createSynced(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.pages.createSyncedBlock(u, id);
  }

  @Post('pages/:id/move-workspace')
  moveWorkspace(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.moves.move(u, id, body);
  }

  @Get('pages/:id/synced')
  synced(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.pages.syncedInfo(u, id);
  }

  @Get('workspaces/:id/trash')
  trashList(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.pages.trashList(u, id);
  }

  @Get('workspaces/:id/archive')
  archiveList(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.pages.archiveList(u, id);
  }

  @Get('workspaces/:id/favorites')
  favorites(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.pages.favorites(u, id);
  }

  @Get('workspaces/:id/recent')
  recent(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.pages.recent(u, id);
  }

  @Get('workspaces/:id/search')
  search(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Query('q') q?: string) {
    return this.pages.search(u, id, typeof q === 'string' ? q : '');
  }

  @Get('pages/:id/summary')
  summary(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.pages.summary(u, id);
  }

  @Get('pages/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.pages.get(u, id);
  }

  @Get('pages/:id/children')
  children(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.pages.children(u, id);
  }

  @Patch('pages/:id')
  update(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.pages.update(u, id, parse(updatePageSchema, body));
  }

  @Post('pages/:id/move')
  @HttpCode(200)
  move(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.pages.move(u, id, parse(movePageSchema, body));
  }

  @Post('pages/:id/archive')
  @HttpCode(200)
  archive(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.pages.setArchived(u, id, true);
  }

  @Post('pages/:id/unarchive')
  @HttpCode(200)
  unarchive(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.pages.setArchived(u, id, false);
  }

  @Delete('pages/:id')
  @HttpCode(204)
  trash(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.pages.trash(u, id);
  }

  @Post('pages/:id/restore')
  @HttpCode(200)
  restore(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.pages.restore(u, id);
  }

  @Delete('pages/:id/permanent')
  @HttpCode(204)
  deletePermanently(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.pages.deletePermanently(u, id);
  }

  @Post('pages/:id/favorite')
  @HttpCode(204)
  addFavorite(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.pages.addFavorite(u, id);
  }

  @Delete('pages/:id/favorite')
  @HttpCode(204)
  removeFavorite(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.pages.removeFavorite(u, id);
  }

  @Post('pages/:id/favorite/reorder')
  @HttpCode(204)
  reorderFavorite(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Body() body: unknown,
  ) {
    return this.pages.reorderFavorite(u, id, parse(reorderFavoriteSchema, body));
  }
}
