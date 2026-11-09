import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/request-context';
import { UUID } from '../common/uuid.pipe';
import { ApiTokensService } from './api-tokens.service';

@Controller('me/tokens')
export class ApiTokensController {
  constructor(private readonly tokens: ApiTokensService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.tokens.list(u);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.tokens.create(u, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.tokens.remove(u, id);
  }
}
