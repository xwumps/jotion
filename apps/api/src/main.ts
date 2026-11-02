import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { parseEnv, serverEnvSchema } from '@jotion/shared/env';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, bodyLimit: 10 * 1024 * 1024 }),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
}

async function bootstrap(): Promise<void> {
  // Konfiguration früh validieren, damit Fehler klar und ohne Stacktrace erscheinen
  const env = parseEnv(serverEnvSchema);
  const app = await createApp();
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
}

if (require.main === module) {
  bootstrap().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
