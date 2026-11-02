import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser, type AuthUser } from '../common/request-context';
import { UUID } from '../common/uuid.pipe';
import { PermissionService } from '../permissions/permission.service';
import { RealtimeService } from './realtime.service';

const HEARTBEAT_MS = 25_000;

@Controller('workspaces/:id/events')
export class EventsController {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly perms: PermissionService,
  ) {}

  /** Server-Sent Events: Änderungen im Workspace, gefiltert auf das, was der Nutzer sehen darf. */
  @Get()
  async stream(
    @CurrentUser() user: AuthUser,
    @Param('id', UUID) workspaceId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.perms.requireMember(user.id, workspaceId);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    const unsubscribe = this.realtime.subscribe(workspaceId, {
      userId: user.id,
      send: (event) =>
        res.write(`id: ${event.id}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`),
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }
}
