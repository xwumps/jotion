import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentUser, Public, type AuthUser } from '../common/request-context';
import { UUID } from '../common/uuid.pipe';
import { AdminService } from './admin.service';

@Controller()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('admin/status')
  status(@CurrentUser() u: AuthUser) {
    return this.admin.status(u);
  }

  @Post('admin/backups')
  @HttpCode(202)
  backup(@CurrentUser() u: AuthUser) {
    return this.admin.requestBackup(u);
  }

  @Get('admin/users')
  users(@CurrentUser() u: AuthUser) {
    return this.admin.users(u);
  }

  @Patch('admin/users/:id')
  updateUser(@CurrentUser() u: AuthUser, @Param('id', UUID) id: string, @Body() body: unknown) {
    return this.admin.updateUser(u, id, body);
  }

  /** Prometheus (Bearer JOTION_METRICS_TOKEN) */
  @Public()
  @Get('metrics')
  async metrics(@Headers('authorization') auth: string | undefined, @Res() res: FastifyReply) {
    const text = await this.admin.metrics(auth);
    return res.header('content-type', 'text/plain; version=0.0.4; charset=utf-8').send(text);
  }
}
