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

// Operational behaviour over HTTP: request IDs, health, metrics and unknown routes.

describe('HTTP operations', () => {
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

  describe('request IDs', () => {
    it('echoes a safe X-Request-Id in the response header and in problem details', async () => {
      const res = await request(app.getHttpServer())
        .get('/appointments/not-a-uuid')
        .set('X-Request-Id', 'client-abc.123');

      expect(res.headers['x-request-id']).toBe('client-abc.123');
      expect(res.body.requestId).toBe('client-abc.123');
    });

    it('generates a UUID when the header is missing or unsafe', async () => {
      const missing = await request(app.getHttpServer()).get('/health/live');
      const unsafe = await request(app.getHttpServer())
        .get('/health/live')
        .set('X-Request-Id', 'not safe {"injected":true}');
      const tooLong = await request(app.getHttpServer())
        .get('/health/live')
        .set('X-Request-Id', 'x'.repeat(129));

      for (const res of [missing, unsafe, tooLong]) {
        expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      }
    });
  });

  describe('health', () => {
    it('reports live and ready when the database answers', async () => {
      const live = await request(app.getHttpServer()).get('/health/live');
      const ready = await request(app.getHttpServer()).get('/health/ready');

      expect([live.status, live.body]).toEqual([200, { status: 'ok' }]);
      expect([ready.status, ready.body]).toEqual([200, { status: 'ok' }]);
    });

    it('reports not ready (503) within about a second when the database is unreachable', async () => {
      const unreachable = await createTestApp({
        env: { DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none' },
      });
      try {
        const started = Date.now();
        const res = await request(unreachable.getHttpServer()).get('/health/ready');

        expect([res.status, res.body]).toEqual([503, { status: 'unavailable' }]);
        expect(Date.now() - started).toBeLessThan(3_000);
      } finally {
        await unreachable.close();
      }
    });
  });

  describe('metrics', () => {
    it('counts bookings by outcome and labels HTTP timings by route template', async () => {
      const dealership = await createDealership(db);
      await createBays(db, dealership.id, 1);
      await createTechnician(db, dealership.id);
      const serviceType = await createServiceType(db);
      const customer = await createCustomerWithVehicle(db);
      const booked = await request(app.getHttpServer()).post('/appointments').send({
        dealershipId: dealership.id,
        customerId: customer.customerId,
        vehicleId: customer.vehicleId,
        serviceTypeId: serviceType.id,
        startsAt: '2026-10-13T10:00:00+01:00',
      });
      expect(booked.status).toBe(201);
      await request(app.getHttpServer()).get(`/appointments/${booked.body.id}`);

      const res = await request(app.getHttpServer()).get('/metrics');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/plain/);
      expect(res.text).toMatch(/^booking_requests_total\{outcome="confirmed"\} [1-9]/m);
      expect(res.text).toMatch(/^booking_conflict_retries_total\{resource="bay"\} \d+/m);
      expect(res.text).toMatch(/^booking_duration_seconds_count [1-9]/m);
      expect(res.text).toContain(
        'http_server_request_duration_seconds_count{method="GET",route="/appointments/:id",status_code="200"}',
      );
      expect(res.text).not.toContain(booked.body.id);
      expect(res.text).toMatch(/^process_cpu_user_seconds_total /m);
    });
  });

  it('answers an unknown route with a 404 problem', async () => {
    const res = await request(app.getHttpServer()).get('/no-such-route');

    expectProblem(res, 404, 'NOT_FOUND');
  });
});
