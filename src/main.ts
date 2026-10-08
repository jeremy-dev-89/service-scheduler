import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { buildOpenApiDocument } from './api/openapi';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfig } from './config/config.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  // Swagger UI at /docs, raw OpenAPI JSON at /docs-json.
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app));

  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.port);
}

void bootstrap();
