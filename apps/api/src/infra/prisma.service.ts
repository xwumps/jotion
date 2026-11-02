import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient, pingDatabase, type PrismaClient } from '@jotion/db';
import type { ServerEnv } from '@jotion/shared/env';
import { SERVER_ENV } from '../config/config.module';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(SERVER_ENV) env: ServerEnv) {
    this.client = createPrismaClient({ url: env.DATABASE_URL });
  }

  ping(): Promise<void> {
    return pingDatabase(this.client);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
