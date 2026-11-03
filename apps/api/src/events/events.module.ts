import { Global, Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { RealtimeService } from './realtime.service';

@Global()
@Module({
  controllers: [EventsController],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class EventsModule {}
