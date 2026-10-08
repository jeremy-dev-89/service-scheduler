// Must stay the first import: starts OpenTelemetry before http, express and pg load.
import './tracing';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { buildOpenApiDocument } from './api/openapi';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfig } from './config/config.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.disable('x-powered-by');
  app.useLogger(app.get(Logger));
  // On SIGTERM: destroy the Kysely pool and flush pending trace spans.
  app.enableShutdownHooks();

  // Swagger UI at /docs, raw OpenAPI JSON at /docs-json.
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app));

  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.port);
}

void bootstrap();
