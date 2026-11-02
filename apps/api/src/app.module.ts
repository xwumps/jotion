import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { InfraModule } from './infra/infra.module';
import { loggerOptions } from './logger';

@Module({
  imports: [LoggerModule.forRoot(loggerOptions()), ConfigModule, InfraModule, HealthModule],
})
export class AppModule {}
