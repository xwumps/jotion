import { Module } from '@nestjs/common';
import { DatabaseAccessService } from './database-access';
import { DatabasesController } from './databases.controller';
import { DatabasesService } from './databases.service';
import { RowsService } from './rows.service';

@Module({
  controllers: [DatabasesController],
  providers: [DatabaseAccessService, DatabasesService, RowsService],
  exports: [DatabaseAccessService],
})
export class DatabasesModule {}
