import { Global, Module } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';
import { RowEventsBus } from './row-events';

@Global()
@Module({ providers: [RateLimitService, RowEventsBus], exports: [RateLimitService, RowEventsBus] })
export class CommonModule {}
