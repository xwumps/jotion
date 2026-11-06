import { Module } from '@nestjs/common';
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
  ],
  exports: [DatabaseAccessService, ComputeService],
})
export class DatabasesModule {}
