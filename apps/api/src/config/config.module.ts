import { Global, Module } from '@nestjs/common';
import { parseEnv, serverEnvSchema, type ServerEnv } from '@jotion/shared/env';

export const SERVER_ENV = Symbol('SERVER_ENV');

@Global()
@Module({
  providers: [{ provide: SERVER_ENV, useFactory: (): ServerEnv => parseEnv(serverEnvSchema) }],
  exports: [SERVER_ENV],
})
export class ConfigModule {}
