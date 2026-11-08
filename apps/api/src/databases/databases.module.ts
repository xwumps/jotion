import { Module } from '@nestjs/common';
import { ChartsService } from './charts.service';
import { ComputeService } from './compute.service';
import { ComputedSchemaService } from './computed-schema';
import { DatabaseAccessService } from './database-access';
import { DatabasesController } from './databases.controller';
import { DatabasesService } from './databases.service';
import { RowsService } from './rows.service';
import { PageCopier } from '../templates/page-copier';

@Module({
  controllers: [DatabasesController],
  providers: [
    DatabaseAccessService,
    DatabasesService,
    RowsService,
    ComputeService,
    ComputedSchemaService,
    ChartsService,
    PageCopier,
  ],
  exports: [
    DatabaseAccessService,
    DatabasesService,
    RowsService,
    ComputeService,
    ChartsService,
    PageCopier,
  ],
})
export class DatabasesModule {}
