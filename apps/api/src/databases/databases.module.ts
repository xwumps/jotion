import { Module } from '@nestjs/common';
import { ChartsService } from './charts.service';
import { ComputeService } from './compute.service';
import { ComputedSchemaService } from './computed-schema';
import { DatabaseAccessService } from './database-access';
import { DatabasesController } from './databases.controller';
import { DatabasesService } from './databases.service';
import { RowsService } from './rows.service';

@Module({
  controllers: [DatabasesController],
  providers: [
    DatabaseAccessService,
    DatabasesService,
    RowsService,
    ComputeService,
    ComputedSchemaService,
    ChartsService,
  ],
  exports: [DatabaseAccessService, ComputeService, ChartsService],
})
export class DatabasesModule {}
