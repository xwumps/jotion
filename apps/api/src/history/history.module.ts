import { Module } from '@nestjs/common';
import { CollabModule } from '../collab/collab.module';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';

@Module({ imports: [CollabModule], controllers: [HistoryController], providers: [HistoryService] })
export class HistoryModule {}
