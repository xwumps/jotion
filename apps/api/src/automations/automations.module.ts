import { Module } from '@nestjs/common';
import { DatabasesModule } from '../databases/databases.module';
import { TemplatesModule } from '../templates/templates.module';
import { AutomationEngine } from './automation-engine';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';

@Module({
  imports: [DatabasesModule, TemplatesModule],
  controllers: [AutomationsController],
  providers: [AutomationEngine, AutomationsService],
  exports: [AutomationEngine],
})
export class AutomationsModule {}
