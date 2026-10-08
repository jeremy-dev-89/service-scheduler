// Writes openapi.yaml from the controllers and DTOs, without a running database:
// the pg pool connects lazily and no query runs. CI fails if the committed file drifts.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { stringify } from 'yaml';
import { buildOpenApiDocument } from '../src/api/openapi';
import { AppModule } from '../src/app.module';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    const document = buildOpenApiDocument(app);
    const target = join(__dirname, '..', 'openapi.yaml');
    writeFileSync(target, stringify(document, { lineWidth: 0, aliasDuplicateObjects: false }));
    console.log(`wrote ${target}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('openapi export failed', error);
  process.exit(1);
});
