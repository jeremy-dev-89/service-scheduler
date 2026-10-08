import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { FileMigrationProvider, type Kysely, type MigrationResult, Migrator } from 'kysely';
import { validateConfig } from '../../config/config.schema';
import { createKysely } from './database.module';
import type { Database } from './database.types';

/** Applies every pending migration in ./migrations. Throws if one fails. */
export async function migrateToLatest(db: Kysely<Database>): Promise<MigrationResult[]> {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, 'migrations'),
    }),
  });

  const { error, results } = await migrator.migrateToLatest();
  if (error) {
    throw error instanceof Error ? error : new Error('Migration failed', { cause: error });
  }
  return results ?? [];
}

async function main(): Promise<void> {
  const config = validateConfig(process.env);
  const db = createKysely(config.databaseUrl, 1);
  try {
    for (const result of await migrateToLatest(db)) {
      console.log(`migration ${result.migrationName}: ${result.status}`);
    }
    console.log('migrations up to date');
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('migration failed', error);
    process.exit(1);
  });
}
