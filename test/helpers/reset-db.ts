import { type Kysely, sql } from 'kysely';
import { createKysely } from '../../src/infrastructure/database/database.module';
import type { Database } from '../../src/infrastructure/database/database.types';

/** A Kysely instance on the test database started by globalSetup. */
export function createTestDb(poolMax = 5): Kysely<Database> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set: run database tests through Jest globalSetup');
  }
  return createKysely(url, poolMax);
}

/** Empties every table so each test builds exactly the data it needs. */
export async function resetDb(db: Kysely<Database>): Promise<void> {
  await sql`
    TRUNCATE appointment, vehicle, customer, technician_qualification, technician,
      service_bay, service_type, qualification, dealership_opening_hours, dealership
    RESTART IDENTITY CASCADE
  `.execute(db);
}
