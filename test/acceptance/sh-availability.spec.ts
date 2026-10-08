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
  insertAppointment,
} from '../helpers/factories';
import { createTestDb, resetDb } from '../helpers/reset-db';

// SHOULD: GET /dealerships/{dealershipId}/availability?serviceTypeId=&date=
// `date` is a local date in the dealership's zone. Now is Mon 12 Oct 2026 09:00Z.

describe('SH availability: GET /dealerships/{dealershipId}/availability', () => {
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

  const at = (hhmm: string, date = '2026-10-13') => `${date}T${hhmm}:00+01:00`;

  const availability = (dealershipId: string, query: Record<string, string>) =>
    request(app.getHttpServer()).get(`/dealerships/${dealershipId}/availability`).query(query);

  it('SH-AV-01 lists every step inside opening hours, without the busy window, for a part-booked day', async () => {
    const dealership = await createDealership(db, { timeZone: 'Europe/London' });
    const [bay] = await createBays(db, dealership.id, 1);
    const technician = await createTechnician(db, dealership.id, { qualifications: ['GENERAL'] });
    const oilService = await createServiceType(db, { durationMinutes: 60 });
    const other = await createCustomerWithVehicle(db);
    await insertAppointment(db, {
      dealershipId: dealership.id,
      customerId: other.customerId,
      vehicleId: other.vehicleId,
      serviceTypeId: oilService.id,
      serviceBayId: bay!.id,
      technicianId: technician.id,
      startsAt: new Date(at('10:00')),
      endsAt: new Date(at('11:00')),
    });

    const res = await availability(dealership.id, {
      serviceTypeId: oilService.id,
      date: '2026-10-13',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      dealershipId: dealership.id,
      serviceTypeId: oilService.id,
      date: '2026-10-13',
      timeZone: 'Europe/London',
      slotStepMinutes: 15,
    });
    const starts: string[] = res.body.availableStarts;
    // 08:00–17:00 every 15 minutes is 37 starts; 09:15–10:45 (7 starts) overlap 10:00–11:00.
    expect(starts).toHaveLength(30);
    expect(starts[0]).toBe(at('08:00'));
    expect(starts).toContain(at('09:00'));
    for (const busy of ['09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45']) {
      expect(starts).not.toContain(at(busy));
    }
    expect(starts).toContain(at('11:00'));
    expect(starts.at(-1)).toBe(at('17:00'));
  });

  it('SH-AV-02 uses the right offset either side of the 25 Oct 2026 clock change', async () => {
    const dealership = await createDealership(db, {
      timeZone: 'Europe/London',
      openingHours: EVERY_DAY_08_TO_18,
    });
    await createBays(db, dealership.id, 1);
    await createTechnician(db, dealership.id, { qualifications: ['GENERAL'] });
    const oilService = await createServiceType(db, { durationMinutes: 60 });

    const saturday = await availability(dealership.id, {
      serviceTypeId: oilService.id,
      date: '2026-10-24',
    });
    const sunday = await availability(dealership.id, {
      serviceTypeId: oilService.id,
      date: '2026-10-25',
    });

    expect(saturday.status).toBe(200);
    expect(saturday.body.availableStarts[0]).toBe('2026-10-24T08:00:00+01:00');
    expect(saturday.body.availableStarts.every((s: string) => s.endsWith('+01:00'))).toBe(true);

    expect(sunday.status).toBe(200);
    expect(sunday.body.availableStarts[0]).toBe('2026-10-25T08:00:00+00:00');
    expect(sunday.body.availableStarts.at(-1)).toBe('2026-10-25T17:00:00+00:00');
    expect(sunday.body.availableStarts.every((s: string) => s.endsWith('+00:00'))).toBe(true);
  });

  it('SH-AV-03 returns an empty list for a closed day', async () => {
    const dealership = await createDealership(db, { timeZone: 'Europe/London' });
    await createBays(db, dealership.id, 1);
    await createTechnician(db, dealership.id, { qualifications: ['GENERAL'] });
    const oilService = await createServiceType(db);

    const res = await availability(dealership.id, {
      serviceTypeId: oilService.id,
      date: '2026-10-17',
    });

    expect(res.status).toBe(200);
    expect(res.body.availableStarts).toEqual([]);
  });

  it('only counts technicians qualified for the service type', async () => {
    const dealership = await createDealership(db, { timeZone: 'Europe/London' });
    await createBays(db, dealership.id, 1);
    await createTechnician(db, dealership.id, { qualifications: ['GENERAL'] });
    const brakes = await createServiceType(db, { qualification: 'BRAKES' });

    const res = await availability(dealership.id, { serviceTypeId: brakes.id, date: '2026-10-13' });

    expect(res.status).toBe(200);
    expect(res.body.availableStarts).toEqual([]);
  });

  it('returns 404 for an unknown dealership or service type', async () => {
    const dealership = await createDealership(db);
    const oilService = await createServiceType(db);

    expectProblem(
      await availability(randomUUID(), { serviceTypeId: oilService.id, date: '2026-10-13' }),
      404,
      'DEALERSHIP_NOT_FOUND',
    );
    expectProblem(
      await availability(dealership.id, { serviceTypeId: randomUUID(), date: '2026-10-13' }),
      404,
      'SERVICE_TYPE_NOT_FOUND',
    );
  });

  it.each([
    ['a missing date', { date: undefined }],
    ['an impossible date', { date: '2026-02-30' }],
    ['a date-time instead of a date', { date: '2026-10-13T10:00:00Z' }],
    ['an invalid service type ID', { serviceTypeId: 'nope' }],
  ])('returns 400 VALIDATION_FAILED for %s', async (_case, override) => {
    const dealership = await createDealership(db);
    const oilService = await createServiceType(db);
    const query = Object.fromEntries(
      Object.entries({ serviceTypeId: oilService.id, date: '2026-10-13', ...override }).filter(
        ([, value]) => value !== undefined,
      ),
    ) as Record<string, string>;

    expectProblem(await availability(dealership.id, query), 400, 'VALIDATION_FAILED');
  });
});
