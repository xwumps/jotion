import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/request-context';
import { UUID } from '../common/uuid.pipe';
import { CommentsService } from './comments.service';

@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('pages/:id/comments')
  list(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.comments.list(u, id);
  }

  @Post('pages/:id/comments')
  @HttpCode(201)
  create(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.comments.create(u, id, body);
  }

  @Patch('comments/:id')
  update(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.comments.update(u, id, body);
  }

  @Delete('comments/:id')
  @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.comments.remove(u, id);
  }

  @Put('comments/:id/resolved')
  @HttpCode(204)
  resolve(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.comments.resolve(u, id, body);
  }

  @Get('workspaces/:id/inbox')
  inbox(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.comments.inbox(u, id);
  }

  @Post('workspaces/:id/inbox/read')
  @HttpCode(204)
  read(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.comments.markRead(u, id, body);
  }
}
