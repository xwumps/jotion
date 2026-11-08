import { Module } from '@nestjs/common';
import { DatabasesModule } from '../databases/databases.module';
import { IntegrationsController, OAuthCallbackController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { SyncRunnerService } from './sync-runner.service';

@Module({
  imports: [DatabasesModule],
  controllers: [IntegrationsController, OAuthCallbackController],
  providers: [IntegrationsService, SyncRunnerService],
  exports: [SyncRunnerService],
})
export class IntegrationsModule {}
