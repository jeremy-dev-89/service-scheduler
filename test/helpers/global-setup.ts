import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { createKysely } from '../../src/infrastructure/database/database.module';
import { migrateToLatest } from '../../src/infrastructure/database/migrator';
import { testState } from './test-state';

/**
 * Starts one PostgreSQL 17 container for the whole Jest run and migrates it once.
 * The integration, acceptance and concurrency projects all register this setup;
 * only the first call does the work. Set TEST_DATABASE_URL to use an existing
 * database instead (for example a CI service container).
 */
export default async function globalSetup(): Promise<void> {
  if (testState.databaseReady) {
    return;
  }

  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  } else {
    const container = await new PostgreSqlContainer('postgres:17').start();
    testState.container = container;
    process.env.DATABASE_URL = container.getConnectionUri();
  }

  const db = createKysely(process.env.DATABASE_URL, 1);
  try {
    await migrateToLatest(db);
  } finally {
    await db.destroy();
  }
  testState.databaseReady = true;
}
