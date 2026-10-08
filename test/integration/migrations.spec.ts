import { type Kysely, sql } from 'kysely';
import type { Database } from '../../src/infrastructure/database/database.types';
import { createTestDb } from '../helpers/reset-db';

describe('0001_initial_schema migration', () => {
  let db: Kysely<Database>;

  beforeAll(() => {
    db = createTestDb();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('creates the three exclusion constraints on appointment', async () => {
    const { rows } = await sql<{ conname: string; definition: string }>`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'appointment'::regclass AND contype = 'x'
      ORDER BY conname
    `.execute(db);

    expect(rows.map((row) => row.conname)).toEqual([
      'appointment_no_bay_overlap',
      'appointment_no_technician_overlap',
      'appointment_no_vehicle_overlap',
    ]);
    for (const row of rows) {
      expect(row.definition).toMatch(/^EXCLUDE USING gist \(\w+ WITH =, period WITH &&\)/);
      expect(row.definition).toContain(`WHERE ((status = 'CONFIRMED'::text))`);
    }
  });

  it('enables btree_gist', async () => {
    const { rows } = await sql<{ extname: string }>`
      SELECT extname FROM pg_extension WHERE extname = 'btree_gist'
    `.execute(db);

    expect(rows).toHaveLength(1);
  });

  it('ties bay and technician to the appointment dealership with composite foreign keys', async () => {
    const { rows } = await sql<{ conname: string }>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'appointment'::regclass AND contype = 'f'
        AND conname IN ('appointment_bay_same_dealership', 'appointment_technician_same_dealership')
      ORDER BY conname
    `.execute(db);

    expect(rows.map((row) => row.conname)).toEqual([
      'appointment_bay_same_dealership',
      'appointment_technician_same_dealership',
    ]);
  });
});
