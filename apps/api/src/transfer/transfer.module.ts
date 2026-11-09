import { Module } from '@nestjs/common';
import { CollabModule } from '../collab/collab.module';
import { DatabasesModule } from '../databases/databases.module';
import { FilesModule } from '../files/files.module';
import { PagesModule } from '../pages/pages.module';
import { TransferController } from './transfer.controller';
import { TransferService } from './transfer.service';

@Module({
  imports: [CollabModule, DatabasesModule, FilesModule, PagesModule],
  controllers: [TransferController],
  providers: [TransferService],
})
export class TransferModule {}
