import { Injectable } from '@nestjs/common';
import { RedisService } from '../infra/redis.service';
import { AppError } from './errors';

/** Einfaches Fixed-Window-Limit in Redis. */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<void> {
    const k = `jotion:rl:${key}`;
    const count = await this.redis.client.incr(k);
    if (count === 1) await this.redis.client.expire(k, windowSeconds);
    if (count > limit) {
      const ttl = await this.redis.client.ttl(k);
      throw new AppError('rate_limited', 'Zu viele Versuche. Bitte später erneut versuchen.', {
        retryAfterSeconds: ttl,
      });
    }
  }

  async reset(key: string): Promise<void> {
    await this.redis.client.del(`jotion:rl:${key}`);
  }
}
