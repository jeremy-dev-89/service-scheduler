import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import request from 'supertest';
import type { Database } from '../../src/infrastructure/database/database.types';
import { createTestApp, expectProblem } from '../helpers/app-factory';
import {
  createBay,
  createBays,
  createCustomerWithVehicle,
  createDealership,
  createServiceType,
  createTechnician,
  insertAppointment,
} from '../helpers/factories';
import { createTestDb, resetDb } from '../helpers/reset-db';

// SHOULD: 409 responses carry alternative start times (AS7, AS16).
// Tue 13 Oct 2026, Europe/London (BST, +01:00), open weekdays 08:00–18:00.

describe('SH alternatives on 409 SLOT_UNAVAILABLE', () => {
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

  const local = (hhmm: string) => new Date(`2026-10-13T${hhmm}:00+01:00`);

  /** One bay, one brakes technician, busy 10:00–12:00 with someone else's car. */
  async function busyMorning() {
    const dealership = await createDealership(db, { timeZone: 'Europe/London' });
    const [bay] = await createBays(db, dealership.id, 1);
    const brakes = await createTechnician(db, dealership.id, { qualifications: ['BRAKES'] });
    const brakeReplacement = await createServiceType(db, {
      durationMinutes: 120,
      qualification: 'BRAKES',
    });
    const someoneElse = await createCustomerWithVehicle(db);
    await insertAppointment(db, {
      dealershipId: dealership.id,
      customerId: someoneElse.customerId,
      vehicleId: someoneElse.vehicleId,
      serviceTypeId: brakeReplacement.id,
      serviceBayId: bay!.id,
      technicianId: brakes.id,
      startsAt: local('10:00'),
      endsAt: local('12:00'),
    });
    const customer = await createCustomerWithVehicle(db);
    return { dealership, bay: bay!, brakes, brakeReplacement, customer };
  }

  const bookingBody = (
    s: Awaited<ReturnType<typeof busyMorning>>,
    startsAt: string,
  ): Record<string, string> => ({
    dealershipId: s.dealership.id,
    customerId: s.customer.customerId,
    vehicleId: s.customer.vehicleId,
    serviceTypeId: s.brakeReplacement.id,
    startsAt,
  });

  it('SH-ALT-01 a 409 carries ALTERNATIVES_COUNT starts, and booking the first returns 201', async () => {
    const s = await busyMorning();

    const conflict = await request(app.getHttpServer())
      .post('/appointments')
      .send(bookingBody(s, '2026-10-13T10:00:00+01:00'));

    expectProblem(conflict, 409, 'SLOT_UNAVAILABLE');
    expect(conflict.body.alternatives).toEqual([
      '2026-10-13T12:00:00+01:00',
      '2026-10-13T12:15:00+01:00',
      '2026-10-13T12:30:00+01:00',
    ]);

    const rebook = await request(app.getHttpServer())
      .post('/appointments')
      .send(bookingBody(s, conflict.body.alternatives[0]));

    expect(rebook.status).toBe(201);
    expect(rebook.body.localStartsAt).toBe('2026-10-13T12:00:00+01:00');
  });

  it('SH-ALT-01 honours a configured ALTERNATIVES_COUNT', async () => {
    const s = await busyMorning();
    const fiveAlternatives = await createTestApp({ env: { ALTERNATIVES_COUNT: '5' } });
    try {
      const conflict = await request(fiveAlternatives.getHttpServer())
        .post('/appointments')
        .send(bookingBody(s, '2026-10-13T10:00:00+01:00'));

      expectProblem(conflict, 409, 'SLOT_UNAVAILABLE');
      expect(conflict.body.alternatives).toHaveLength(5);
    } finally {
      await fiveAlternatives.close();
    }
  });

  it('SH-ALT-02 alternatives skip the times when the vehicle is already booked later that day', async () => {
    const s = await busyMorning();
    // The customer's own car is booked 12:00–13:00 in a second bay with another technician.
    const bay2 = await createBay(db, s.dealership.id, 'Bay 02');
    const general = await createTechnician(db, s.dealership.id, { qualifications: ['GENERAL'] });
    await insertAppointment(db, {
      dealershipId: s.dealership.id,
      customerId: s.customer.customerId,
      vehicleId: s.customer.vehicleId,
      serviceTypeId: s.brakeReplacement.id,
      serviceBayId: bay2.id,
      technicianId: general.id,
      startsAt: local('12:00'),
      endsAt: local('13:00'),
    });

    const conflict = await request(app.getHttpServer())
      .post('/appointments')
      .send(bookingBody(s, '2026-10-13T10:00:00+01:00'));

    // Bay 1 and the brakes technician are free from 12:00, but the car is not until 13:00.
    expectProblem(conflict, 409, 'SLOT_UNAVAILABLE');
    expect(conflict.body.alternatives).toEqual([
      '2026-10-13T13:00:00+01:00',
      '2026-10-13T13:15:00+01:00',
      '2026-10-13T13:30:00+01:00',
    ]);
  });

  it('SH-ALT-01 continues on the next open day when the rest of the day is full', async () => {
    const s = await busyMorning();
    // Fri 16 Oct: the only bay and technician are busy 14:00–18:00; the weekend is closed.
    const friday = await createCustomerWithVehicle(db);
    await insertAppointment(db, {
      dealershipId: s.dealership.id,
      customerId: friday.customerId,
      vehicleId: friday.vehicleId,
      serviceTypeId: s.brakeReplacement.id,
      serviceBayId: s.bay.id,
      technicianId: s.brakes.id,
      startsAt: new Date('2026-10-16T14:00:00+01:00'),
      endsAt: new Date('2026-10-16T18:00:00+01:00'),
    });

    const conflict = await request(app.getHttpServer())
      .post('/appointments')
      .send(bookingBody(s, '2026-10-16T14:00:00+01:00'));

    expectProblem(conflict, 409, 'SLOT_UNAVAILABLE');
    expect(conflict.body.alternatives).toEqual([
      '2026-10-19T08:00:00+01:00',
      '2026-10-19T08:15:00+01:00',
      '2026-10-19T08:30:00+01:00',
    ]);
  });
});
