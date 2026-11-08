import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { CurrentUser, Public, type AuthUser } from '../common/request-context';
import { UUID } from '../common/uuid.pipe';
import { SharingService } from './sharing.service';

@Controller()
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  @Get('pages/:id/sharing')
  get(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.sharing.get(u, id);
  }

  @Put('pages/:id/permissions')
  set(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.sharing.setPermission(u, id, body);
  }

  @Post('pages/:id/share-link')
  @HttpCode(201)
  createLink(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.sharing.createLink(u, id);
  }

  @Delete('pages/:id/share-link')
  @HttpCode(204)
  deleteLink(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string) {
    return this.sharing.deleteLink(u, id);
  }

  /** Öffentlich: Leseansicht über einen Lese-Link */
  @Public()
  @Get('share/:token')
  publicPage(@Param('token') token: string, @Query('page') page?: string) {
    const valid = /^[0-9a-f-]{36}$/i.test(page ?? '') ? page : undefined;
    return this.sharing.publicPage(String(token).slice(0, 128), valid);
  }
}
