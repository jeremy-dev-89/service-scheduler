import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
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

// A3 Confirmed Appointment Record: "Upon success, create a persistent Appointment record
// associating the customer, vehicle, technician, and service bay."

describe('A3 appointment record: persisted and readable', () => {
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

  async function bookOne() {
    const dealership = await createDealership(db, { timeZone: 'Europe/London' });
    await createBays(db, dealership.id, 1);
    await createTechnician(db, dealership.id, { qualifications: ['GENERAL', 'BRAKES'] });
    const serviceType = await createServiceType(db, {
      durationMinutes: 120,
      qualification: 'BRAKES',
    });
    const customer = await createCustomerWithVehicle(db);
    const requestBody = {
      dealershipId: dealership.id,
      customerId: customer.customerId,
      vehicleId: customer.vehicleId,
      serviceTypeId: serviceType.id,
      startsAt: '2026-10-13T10:00:00+01:00',
    };

    const res = await request(app.getHttpServer()).post('/appointments').send(requestBody);
    expect(res.status).toBe(201);
    return { requestBody, created: res.body };
  }

  it('AT-A3-01 GET /appointments/{id} returns 200 with exactly the POST response', async () => {
    const { created } = await bookOne();

    const res = await request(app.getHttpServer()).get(`/appointments/${created.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(created);
  });

  it('AT-A3-02 persists a row with all six foreign keys and a half-open period', async () => {
    const { requestBody, created } = await bookOne();

    const row = await db
      .selectFrom('appointment')
      .select([
        'dealership_id',
        'customer_id',
        'vehicle_id',
        'service_type_id',
        'service_bay_id',
        'technician_id',
        'status',
        'cancelled_at',
        sql<Date>`lower(period)`.as('starts_at'),
        sql<Date>`upper(period)`.as('ends_at'),
        sql<boolean>`lower_inc(period)`.as('lower_inclusive'),
        sql<boolean>`upper_inc(period)`.as('upper_inclusive'),
      ])
      .where('id', '=', created.id)
      .executeTakeFirstOrThrow();

    expect(row).toEqual({
      dealership_id: requestBody.dealershipId,
      customer_id: requestBody.customerId,
      vehicle_id: requestBody.vehicleId,
      service_type_id: requestBody.serviceTypeId,
      service_bay_id: created.serviceBay.id,
      technician_id: created.technician.id,
      status: 'CONFIRMED',
      cancelled_at: null,
      starts_at: new Date('2026-10-13T09:00:00Z'),
      ends_at: new Date('2026-10-13T11:00:00Z'),
      lower_inclusive: true,
      upper_inclusive: false,
    });
  });

  it('AT-A3-03 returns 404 APPOINTMENT_NOT_FOUND for an unknown ID', async () => {
    const res = await request(app.getHttpServer()).get(`/appointments/${randomUUID()}`);

    expectProblem(res, 404, 'APPOINTMENT_NOT_FOUND');
  });

  it('AT-A3-03 returns 400 VALIDATION_FAILED for an ID that is not a UUID', async () => {
    const res = await request(app.getHttpServer()).get('/appointments/not-a-uuid');

    expectProblem(res, 400, 'VALIDATION_FAILED');
  });
});
