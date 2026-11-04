import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { MAX_IMAGE_UPLOAD_BYTES } from '@jotion/shared';
import { parseEnv, serverEnvSchema } from '@jotion/shared/env';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { registerOriginCheck } from './auth/origin-check';
import { AllExceptionsFilter } from './common/exception.filter';

export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, bodyLimit: 10 * 1024 * 1024 }),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());

  const env = parseEnv(serverEnvSchema);
  const fastify = app.getHttpAdapter().getInstance();
  await app.register(fastifyCookie as never);
  await app.register(fastifyMultipart as never, {
    // Je Route enger begrenzt (Bilder 10 MB, allgemeine Dateien JOTION_MAX_UPLOAD_MB)
    limits: {
      fileSize: Math.max(MAX_IMAGE_UPLOAD_BYTES, env.JOTION_MAX_UPLOAD_MB * 1024 * 1024 + 1),
      files: 1,
    },
  });
  registerOriginCheck(fastify, [env.JOTION_PUBLIC_URL, ...env.JOTION_ALLOWED_ORIGINS]);
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
