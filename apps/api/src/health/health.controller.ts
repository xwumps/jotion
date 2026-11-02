import { Controller, Get, Res } from '@nestjs/common';
import {
  aggregateHealth,
  isHeartbeatFresh,
  parseHeartbeat,
  runCheck,
  WORKER_HEARTBEAT_KEY,
  type HealthReport,
} from '@jotion/shared';
import type { FastifyReply } from 'fastify';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { API_VERSION } from '../version';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Prozess lebt (für Docker-Restart). Prüft keine Abhängigkeiten. */
  @Get('live')
  live() {
    return { status: 'ok', service: 'api', version: API_VERSION };
  }

  /** Bereit für Traffic: Datenbank und Redis erreichbar. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthReport> {
    const report = aggregateHealth('api', API_VERSION, {
      database: await runCheck(() => this.prisma.ping()),
      redis: await runCheck(() => this.redis.ping()),
    });
    reply.status(report.status === 'ok' ? 200 : 503);
    return report;
  }

  /** Gesamtsystem inkl. Worker-Heartbeat (für die Statusanzeige in der UI). */
  @Get('system')
  async system(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthReport> {
    const [database, redis, worker] = await Promise.all([
      runCheck(() => this.prisma.ping()),
      runCheck(() => this.redis.ping()),
      runCheck(async () => {
        const hb = parseHeartbeat(await this.redis.client.get(WORKER_HEARTBEAT_KEY));
        if (!isHeartbeatFresh(hb)) throw new Error('Kein aktueller Heartbeat');
      }),
    ]);
    const report = aggregateHealth('system', API_VERSION, { database, redis, worker });
    reply.status(report.status === 'ok' ? 200 : 503);
    return report;
  }
}
