import { Module } from '@nestjs/common';
import { DatabasesModule } from '../databases/databases.module';
import { ContentController } from './content.controller';
import { DuplicateService } from './duplicate.service';
import { LinkPreviewService } from './link-preview.service';
import { SearchService } from './search.service';

/** Phase 3: Volltextsuche, Erwähnungen, Link-Vorschau, Duplizieren, Druckansicht. */
@Module({
  imports: [DatabasesModule],
  controllers: [ContentController],
  providers: [SearchService, LinkPreviewService, DuplicateService],
})
export class ContentModule {}
