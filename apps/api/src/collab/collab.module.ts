import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CollabService } from './collab.service';
import { DocStore } from './doc-store';

@Global()
@Module({
  imports: [AuthModule],
  providers: [CollabService, DocStore],
  exports: [CollabService, DocStore],
})
export class CollabModule {}
