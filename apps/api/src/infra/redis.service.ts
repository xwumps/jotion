import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { ServerEnv } from '@jotion/shared/env';
import { Redis } from 'ioredis';
import { SERVER_ENV } from '../config/config.module';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(SERVER_ENV) env: ServerEnv) {
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });
    // Fehler werden über Healthchecks sichtbar, nicht als unbehandelte Events
    this.client.on('error', () => undefined);
  }

  async ping(): Promise<void> {
    const res = await this.client.ping();
    if (res !== 'PONG') throw new Error(`Unerwartete Antwort: ${res}`);
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}
