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
  EVERY_DAY_08_TO_18,
} from '../helpers/factories';
import { createTestDb, resetDb } from '../helpers/reset-db';

// A1 Resource Constrained Booking: "Allow a user to request a service appointment for a
// specific vehicle, service type, and dealership at a desired time."
// Now is Mon 12 Oct 2026 09:00Z (10:00 BST). Europe/London is on BST (+01:00) until 25 Oct.

describe('A1 booking request: POST /appointments', () => {
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

  /** One London dealership open weekdays 08:00–18:00, one bay, one GENERAL technician. */
  async function londonScenario(options: { openEveryDay?: boolean } = {}) {
    const dealership = await createDealership(db, {
      name: 'Northside Test Motors',
      timeZone: 'Europe/London',
      ...(options.openEveryDay ? { openingHours: EVERY_DAY_08_TO_18 } : {}),
    });
    const [bay] = await createBays(db, dealership.id, 1);
    const technician = await createTechnician(db, dealership.id, {
      name: 'Casey General',
      qualifications: ['GENERAL'],
    });
    const serviceType = await createServiceType(db, {
      code: 'OIL_SERVICE',
      name: 'Oil service',
      durationMinutes: 60,
      qualification: 'GENERAL',
    });
    const customer = await createCustomerWithVehicle(db, { fullName: 'Robin Example' });
    return { dealership, bay: bay!, technician, serviceType, customer };
  }

  type Scenario = Awaited<ReturnType<typeof londonScenario>>;

  const body = (s: Scenario, startsAt: string) => ({
    dealershipId: s.dealership.id,
    customerId: s.customer.customerId,
    vehicleId: s.customer.vehicleId,
    serviceTypeId: s.serviceType.id,
    startsAt,
  });

  const appointmentCount = async () =>
    Number(
      (
        await db
          .selectFrom('appointment')
          .select((eb) => eb.fn.countAll().as('n'))
          .executeTakeFirstOrThrow()
      ).n,
    );

  it('AT-A1-01 books a valid request: 201, Location, six associations, end = start + duration, local times', async () => {
    const s = await londonScenario();

    const res = await request(app.getHttpServer())
      .post('/appointments')
      .send(body(s, '2026-10-13T10:00:00+01:00'));

    expect(res.status).toBe(201);
    expect(res.headers['location']).toBe(`/appointments/${res.body.id}`);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      status: 'CONFIRMED',
      startsAt: '2026-10-13T09:00:00.000Z',
      endsAt: '2026-10-13T10:00:00.000Z',
      localStartsAt: '2026-10-13T10:00:00+01:00',
      localEndsAt: '2026-10-13T11:00:00+01:00',
      dealership: { id: s.dealership.id, name: 'Northside Test Motors', timeZone: 'Europe/London' },
      customer: { id: s.customer.customerId, fullName: 'Robin Example' },
      vehicle: {
        id: s.customer.vehicleId,
        vin: s.customer.vin,
        make: 'Testmake',
        model: 'Testmodel',
      },
      serviceType: {
        id: s.serviceType.id,
        code: 'OIL_SERVICE',
        name: 'Oil service',
        durationMinutes: 60,
      },
      serviceBay: { id: s.bay.id, name: s.bay.name },
      technician: { id: s.technician.id, name: 'Casey General' },
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
    expect(await appointmentCount()).toBe(1);
  });

  it('AT-A1-01 reports local times in the dealership zone (Asia/Ho_Chi_Minh, +07:00)', async () => {
    const dealership = await createDealership(db, {
      timeZone: 'Asia/Ho_Chi_Minh',
      openingHours: [1, 2, 3, 4, 5, 6].map((d) => ({
        isoDayOfWeek: d,
        opensAt: '07:30',
        closesAt: '17:30',
      })),
    });
    await createBays(db, dealership.id, 1);
    await createTechnician(db, dealership.id, { qualifications: ['GENERAL'] });
    const serviceType = await createServiceType(db, { durationMinutes: 90 });
    const customer = await createCustomerWithVehicle(db);

    const res = await request(app.getHttpServer()).post('/appointments').send({
      dealershipId: dealership.id,
      customerId: customer.customerId,
      vehicleId: customer.vehicleId,
      serviceTypeId: serviceType.id,
      startsAt: '2026-10-13T00:30:00Z',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      startsAt: '2026-10-13T00:30:00.000Z',
      endsAt: '2026-10-13T02:00:00.000Z',
      localStartsAt: '2026-10-13T07:30:00+07:00',
      localEndsAt: '2026-10-13T09:00:00+07:00',
      dealership: { timeZone: 'Asia/Ho_Chi_Minh' },
    });
  });

  it.each([
    ['dealershipId', 'DEALERSHIP_NOT_FOUND'],
    ['customerId', 'CUSTOMER_NOT_FOUND'],
    ['vehicleId', 'VEHICLE_NOT_FOUND'],
    ['serviceTypeId', 'SERVICE_TYPE_NOT_FOUND'],
  ])('AT-A1-02 returns 404 when %s is unknown (%s)', async (field, code) => {
    const s = await londonScenario();

    const res = await request(app.getHttpServer())
      .post('/appointments')
      .send({ ...body(s, '2026-10-13T10:00:00+01:00'), [field]: randomUUID() });

    expectProblem(res, 404, code);
    expect(await appointmentCount()).toBe(0);
  });

  it('AT-A1-03 returns 422 when the vehicle belongs to another customer', async () => {
    const s = await londonScenario();
    const otherCustomer = await createCustomerWithVehicle(db);

    const res = await request(app.getHttpServer())
      .post('/appointments')
      .send({ ...body(s, '2026-10-13T10:00:00+01:00'), vehicleId: otherCustomer.vehicleId });

    expectProblem(res, 422, 'VEHICLE_NOT_OWNED_BY_CUSTOMER');
    expect(await appointmentCount()).toBe(0);
  });

  it.each([
    ['earlier today, inside opening hours', '2026-10-12T09:30:00+01:00'],
    ['exactly now', '2026-10-12T10:00:00+01:00'],
  ])('AT-A1-04 returns 422 START_IN_PAST for a start %s', async (_case, startsAt) => {
    const s = await londonScenario();

    const res = await request(app.getHttpServer()).post('/appointments').send(body(s, startsAt));

    expectProblem(res, 422, 'START_IN_PAST');
    expect(await appointmentCount()).toBe(0);
  });

  it('AT-A1-04 returns 422 BEYOND_BOOKING_HORIZON for a start after now + 90 days', async () => {
    const s = await londonScenario({ openEveryDay: true });

    // now + 90 days = Sun 10 Jan 2027 09:00Z; one day later is beyond the horizon.
    const res = await request(app.getHttpServer())
      .post('/appointments')
      .send(body(s, '2027-01-11T09:00:00+00:00'));

    expectProblem(res, 422, 'BEYOND_BOOKING_HORIZON');
    expect(await appointmentCount()).toBe(0);
  });

  it('AT-A1-04 accepts a start exactly at the horizon', async () => {
    const s = await londonScenario({ openEveryDay: true });

    const res = await request(app.getHttpServer())
      .post('/appointments')
      .send(body(s, '2027-01-10T09:00:00+00:00'));

    expect(res.status).toBe(201);
  });

  it.each([
    ['on a closed day (Saturday)', '2026-10-17T10:00:00+01:00', 60],
    ['when the period runs past closing', '2026-10-13T17:00:00+01:00', 120],
    ['when the start is before opening', '2026-10-13T07:30:00+01:00', 60],
  ])('AT-A1-05 returns 422 OUTSIDE_OPENING_HOURS %s', async (_case, startsAt, duration) => {
    const s = await londonScenario();
    const serviceType = await createServiceType(db, { durationMinutes: duration });

    const res = await request(app.getHttpServer())
      .post('/appointments')
      .send({ ...body(s, startsAt), serviceTypeId: serviceType.id });

    expectProblem(res, 422, 'OUTSIDE_OPENING_HOURS');
    expect(await appointmentCount()).toBe(0);
  });

  it.each([
    ['a missing field', (b: Record<string, unknown>) => ({ ...b, vehicleId: undefined })],
    ['an invalid UUID', (b: Record<string, unknown>) => ({ ...b, dealershipId: 'not-a-uuid' })],
    [
      'startsAt without an offset',
      (b: Record<string, unknown>) => ({ ...b, startsAt: '2026-10-13T10:00:00' }),
    ],
    ['startsAt that is not a date', (b: Record<string, unknown>) => ({ ...b, startsAt: 'soon' })],
  ])('AT-A1-06 returns 400 VALIDATION_FAILED for %s', async (_case, mutate) => {
    const s = await londonScenario();

    const res = await request(app.getHttpServer())
      .post('/appointments')
      .send(mutate(body(s, '2026-10-13T10:00:00+01:00')));

    expectProblem(res, 400, 'VALIDATION_FAILED');
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.anything()]));
    expect(await appointmentCount()).toBe(0);
  });

  it('AT-A1-06 returns 400 VALIDATION_FAILED for a malformed JSON body', async () => {
    const res = await request(app.getHttpServer())
      .post('/appointments')
      .set('Content-Type', 'application/json')
      .send('{"dealershipId": ');

    expectProblem(res, 400, 'VALIDATION_FAILED');
    expect(Array.isArray(res.body.errors)).toBe(true);
  });
});
