import { Module } from '@nestjs/common';
import { CollabModule } from '../collab/collab.module';
import { SharingController } from './sharing.controller';
import { SharingService } from './sharing.service';

@Module({ imports: [CollabModule], controllers: [SharingController], providers: [SharingService] })
export class SharingModule {}
