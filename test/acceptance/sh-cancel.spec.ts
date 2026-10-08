import { randomUUID } from 'node:crypto';
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

// SHOULD: POST /appointments/{id}/cancel, idempotent. Only CONFIRMED blocks resources (AS10).

describe('SH cancel: POST /appointments/{id}/cancel', () => {
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

  it('SH-CAN-01 cancel returns 200 CANCELLED, the slot can be rebooked, and a second cancel is unchanged', async () => {
    const dealership = await createDealership(db, { timeZone: 'Europe/London' });
    await createBays(db, dealership.id, 1);
    await createTechnician(db, dealership.id, { qualifications: ['GENERAL'] });
    const serviceType = await createServiceType(db, { durationMinutes: 60 });
    const first = await createCustomerWithVehicle(db);
    const second = await createCustomerWithVehicle(db);
    const book = (customer: { customerId: string; vehicleId: string }) =>
      request(app.getHttpServer()).post('/appointments').send({
        dealershipId: dealership.id,
        customerId: customer.customerId,
        vehicleId: customer.vehicleId,
        serviceTypeId: serviceType.id,
        startsAt: '2026-10-13T10:00:00+01:00',
      });

    const booked = await book(first);
    expect(booked.status).toBe(201);
    // The only bay and technician are taken.
    expectProblem(await book(second), 409, 'SLOT_UNAVAILABLE');

    const cancelled = await request(app.getHttpServer()).post(
      `/appointments/${booked.body.id}/cancel`,
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toEqual({ ...booked.body, status: 'CANCELLED' });

    const rebooked = await book(second);
    expect(rebooked.status).toBe(201);
    expect(rebooked.body.serviceBay.id).toBe(booked.body.serviceBay.id);
    expect(rebooked.body.technician.id).toBe(booked.body.technician.id);

    const cancelledAgain = await request(app.getHttpServer()).post(
      `/appointments/${booked.body.id}/cancel`,
    );
    expect(cancelledAgain.status).toBe(200);
    expect(cancelledAgain.body).toEqual(cancelled.body);

    const rows = await db
      .selectFrom('appointment')
      .select(['id', 'status', 'cancelled_at'])
      .orderBy('created_at')
      .execute();
    expect(rows).toEqual([
      { id: booked.body.id, status: 'CANCELLED', cancelled_at: new Date('2026-10-12T09:00:00Z') },
      { id: rebooked.body.id, status: 'CONFIRMED', cancelled_at: null },
    ]);
    const read = await request(app.getHttpServer()).get(`/appointments/${booked.body.id}`);
    expect(read.body.status).toBe('CANCELLED');
  });

  it('returns 404 APPOINTMENT_NOT_FOUND for an unknown appointment', async () => {
    const res = await request(app.getHttpServer()).post(`/appointments/${randomUUID()}/cancel`);

    expectProblem(res, 404, 'APPOINTMENT_NOT_FOUND');
  });

  it('returns 400 VALIDATION_FAILED for an ID that is not a UUID', async () => {
    const res = await request(app.getHttpServer()).post('/appointments/nope/cancel');

    expectProblem(res, 400, 'VALIDATION_FAILED');
  });
});
