import type { INestApplication } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import request from 'supertest';
import type { Database } from '../../src/infrastructure/database/database.types';
import { createTestApp } from '../helpers/app-factory';
import {
  createBays,
  createCustomersWithVehicles,
  createDealership,
  createServiceType,
  createTechnicians,
} from '../helpers/factories';
import { createTestDb, resetDb } from '../helpers/reset-db';

// Parallel requests for one start. Every request uses a different customer and vehicle,
// so the bay and technician constraints decide the race, not the vehicle constraint.
// Each scenario runs ITERATIONS times with a reset in between to expose flaky races.

const ITERATIONS = 5;
const STARTS_AT = '2026-10-13T10:00:00+01:00';

describe('Concurrency: parallel bookings for the same slot', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  async function race(setup: { bays: number; technicians: number; requests: number }) {
    await resetDb(db);
    const dealership = await createDealership(db, { timeZone: 'Europe/London' });
    await createBays(db, dealership.id, setup.bays);
    await createTechnicians(db, dealership.id, setup.technicians, ['BRAKES']);
    const serviceType = await createServiceType(db, {
      durationMinutes: 120,
      qualification: 'BRAKES',
    });
    const customers = await createCustomersWithVehicles(db, setup.requests);

    const responses = await Promise.all(
      customers.map((customer) =>
        request(app.getHttpServer()).post('/appointments').send({
          dealershipId: dealership.id,
          customerId: customer.customerId,
          vehicleId: customer.vehicleId,
          serviceTypeId: serviceType.id,
          startsAt: STARTS_AT,
        }),
      ),
    );

    const created = responses.filter((res) => res.status === 201);
    const rejected = responses.filter((res) => res.status !== 201);
    const rows = await db
      .selectFrom('appointment')
      .select(['id', 'service_bay_id', 'technician_id'])
      .where('status', '=', 'CONFIRMED')
      .execute();

    return { created, rejected, rows };
  }

  /** Every pair of confirmed rows sharing a bay or a technician must not overlap. */
  async function overlappingPairsPerResource(): Promise<number> {
    const { rows } = await sql<{ n: string }>`
      SELECT count(*) AS n
      FROM appointment a
      JOIN appointment b ON a.id < b.id AND a.period && b.period
      WHERE a.status = 'CONFIRMED' AND b.status = 'CONFIRMED'
        AND (a.service_bay_id = b.service_bay_id OR a.technician_id = b.technician_id)
    `.execute(db);
    return Number(rows[0]?.n);
  }

  function expectAllSlotUnavailable(rejected: request.Response[]): void {
    expect(rejected.map((res) => ({ status: res.status, code: res.body?.code }))).toEqual(
      rejected.map(() => ({ status: 409, code: 'SLOT_UNAVAILABLE' })),
    );
  }

  it('CT-01 1 bay, 1 qualified technician, 50 parallel requests: exactly one 201, 49 × 409, one row', async () => {
    for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
      const { created, rejected, rows } = await race({ bays: 1, technicians: 1, requests: 50 });

      expect({ iteration, created: created.length, rejected: rejected.length }).toEqual({
        iteration,
        created: 1,
        rejected: 49,
      });
      expectAllSlotUnavailable(rejected);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(created[0]!.body.id);
    }
  });

  it('CT-02 2 bays, 2 qualified technicians, 20 parallel requests: exactly two 201, 18 × 409, no overlap per resource', async () => {
    for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
      const { created, rejected, rows } = await race({ bays: 2, technicians: 2, requests: 20 });

      expect({ iteration, created: created.length, rejected: rejected.length }).toEqual({
        iteration,
        created: 2,
        rejected: 18,
      });
      expectAllSlotUnavailable(rejected);
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.service_bay_id)).size).toBe(2);
      expect(new Set(rows.map((row) => row.technician_id)).size).toBe(2);
      expect(await overlappingPairsPerResource()).toBe(0);
    }
  });

  it('CT-03 1 bay, 3 qualified technicians, 10 parallel requests: exactly one 201 from bay contention alone', async () => {
    for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
      const { created, rejected, rows } = await race({ bays: 1, technicians: 3, requests: 10 });

      expect({ iteration, created: created.length, rejected: rejected.length }).toEqual({
        iteration,
        created: 1,
        rejected: 9,
      });
      expectAllSlotUnavailable(rejected);
      expect(rows).toHaveLength(1);
    }
  });
});
