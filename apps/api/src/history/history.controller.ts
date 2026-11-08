import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/request-context';
import { UUID } from '../common/uuid.pipe';
import { HistoryService } from './history.service';

@Controller()
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get('pages/:id/history')
  list(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.history.list(u, id);
  }

  @Get('pages/:id/history/:vid')
  get(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Param('vid', UUID) vid: string) {
    return this.history.get(u, id, vid);
  }

  @Post('pages/:id/history/:vid/restore')
  @HttpCode(201)
  restore(
    @CurrentUser() u: AuthUser,
    @Param('id', UUID) id: string,
    @Param('vid', UUID) vid: string,
  ) {
    return this.history.restore(u, id, vid);
  }
}
