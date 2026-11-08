import { Module } from '@nestjs/common';
import { DatabasesModule } from '../databases/databases.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { SyncRunnerService } from './sync-runner.service';

@Module({
  imports: [DatabasesModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, SyncRunnerService],
  exports: [SyncRunnerService],
})
export class IntegrationsModule {}
