import { Module } from '@nestjs/common';
import { PagesController } from './pages.controller';
import { PagesService } from './pages.service';
import { WorkspaceMoveService } from './workspace-move.service';

@Module({
  controllers: [PagesController],
  providers: [PagesService, WorkspaceMoveService],
  exports: [PagesService],
})
export class PagesModule {}
