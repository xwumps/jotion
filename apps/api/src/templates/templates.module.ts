import { Module } from '@nestjs/common';
import { DatabasesModule } from '../databases/databases.module';
import { PagesModule } from '../pages/pages.module';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  imports: [DatabasesModule, PagesModule],
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
