import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import request from 'supertest';
import type { Database } from '../../src/infrastructure/database/database.types';
import { createTestApp, expectProblem } from '../helpers/app-factory';
import {
  createBays,
  createCustomerWithVehicle,
  createDealership,
  createServiceType,
  createTechnician,
} from '../helpers/factories';
import { createTestDb, resetDb } from '../helpers/reset-db';

// SHOULD: Idempotency-Key on POST /appointments. Same key and body: the stored appointment
// is returned with 200 and Idempotent-Replayed: true. Same key, different body: 422.

describe('SH idempotency: Idempotency-Key on POST /appointments', () => {
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

  beforeEach(async () => {
    await resetDb(db);
  });

  async function scenario() {
    const dealership = await createDealership(db, { timeZone: 'Europe/London' });
    await createBays(db, dealership.id, 2);
    await createTechnician(db, dealership.id, { qualifications: ['GENERAL'] });
    await createTechnician(db, dealership.id, { qualifications: ['GENERAL'] });
    const serviceType = await createServiceType(db, { durationMinutes: 60 });
    const customer = await createCustomerWithVehicle(db);
    return {
      dealershipId: dealership.id,
      customerId: customer.customerId,
      vehicleId: customer.vehicleId,
      serviceTypeId: serviceType.id,
      startsAt: '2026-10-13T10:00:00+01:00',
    };
  }

  const post = (body: object, key?: string) => {
    const req = request(app.getHttpServer()).post('/appointments');
    return (key === undefined ? req : req.set('Idempotency-Key', key)).send(body);
  };

  const rowCount = async () =>
    Number(
      (
        await db
          .selectFrom('appointment')
          .select((eb) => eb.fn.countAll().as('n'))
          .executeTakeFirstOrThrow()
      ).n,
    );

  it('SH-IDEM-01 the same key and body twice returns the same appointment, one row, and marks the replay', async () => {
    const body = await scenario();

    const first = await post(body, 'booking-key-1');
    const replay = await post(body, 'booking-key-1');

    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect(await rowCount()).toBe(1);
  });

  it('SH-IDEM-01 treats the same body with keys in a different order as the same request', async () => {
    const body = await scenario();
    const reordered = Object.fromEntries(Object.entries(body).reverse());

    const first = await post(body, 'booking-key-order');
    const replay = await post(reordered, 'booking-key-order');

    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
  });

  it('SH-IDEM-02 the same key with a different body returns 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const body = await scenario();

    const first = await post(body, 'booking-key-2');
    const reused = await post({ ...body, startsAt: '2026-10-13T14:00:00+01:00' }, 'booking-key-2');

    expect(first.status).toBe(201);
    expectProblem(reused, 422, 'IDEMPOTENCY_KEY_REUSED');
    expect(await rowCount()).toBe(1);
  });

  it('SH-IDEM-03 10 parallel requests with the same key create one row and all return its ID', async () => {
    for (let iteration = 1; iteration <= 5; iteration += 1) {
      await resetDb(db);
      const body = await scenario();

      const responses = await Promise.all(
        Array.from({ length: 10 }, () => post(body, `parallel-key-${iteration}`)),
      );

      const statuses = responses.map((res) => res.status).sort();
      expect({ iteration, statuses }).toEqual({
        iteration,
        statuses: [200, 200, 200, 200, 200, 200, 200, 200, 200, 201],
      });
      const ids = new Set(responses.map((res) => res.body.id as string));
      expect(ids.size).toBe(1);
      expect(await rowCount()).toBe(1);
    }
  });

  it('without a key, the same body twice is a new booking attempt (409 for the same vehicle)', async () => {
    const body = await scenario();

    expect((await post(body)).status).toBe(201);
    expectProblem(await post(body), 409, 'VEHICLE_ALREADY_BOOKED');
  });

  it.each([
    ['empty', ''],
    ['longer than 128 characters', 'k'.repeat(129)],
  ])('returns 400 VALIDATION_FAILED for a key that is %s', async (_case, key) => {
    const body = await scenario();

    expectProblem(await post(body, key), 400, 'VALIDATION_FAILED');
    expect(await rowCount()).toBe(0);
  });
});
