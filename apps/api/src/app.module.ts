import { DashboardModule } from './dashboard/dashboard.module';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { CollabModule } from './collab/collab.module';
import { CommonModule } from './common/common.module';
import { ContentModule } from './content/content.module';
import { DatabasesModule } from './databases/databases.module';
import { ConfigModule } from './config/config.module';
import { EventsModule } from './events/events.module';
import { FilesModule } from './files/files.module';
import { HealthModule } from './health/health.module';
import { InfraModule } from './infra/infra.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { TemplatesModule } from './templates/templates.module';
import { AutomationsModule } from './automations/automations.module';
import { loggerOptions } from './logger';
import { PagesModule } from './pages/pages.module';
import { SharingModule } from './sharing/sharing.module';
import { CommentsModule } from './comments/comments.module';
import { PermissionsModule } from './permissions/permissions.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
  imports: [
    LoggerModule.forRoot(loggerOptions()),
    ConfigModule,
    InfraModule,
    CommonModule,
    PermissionsModule,
    EventsModule,
    AuthModule,
    CollabModule,
    WorkspacesModule,
    PagesModule,
    DatabasesModule,
    FilesModule,
    ContentModule,
    HealthModule,
    DashboardModule,
    IntegrationsModule,
    TemplatesModule,
    AutomationsModule,
    SharingModule,
    CommentsModule,
  ],
})
export class AppModule {}
