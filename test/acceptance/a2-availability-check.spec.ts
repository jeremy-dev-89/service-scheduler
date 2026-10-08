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
  type DealershipFixture,
  insertAppointment,
  type ServiceTypeFixture,
} from '../helpers/factories';
import { createTestDb, resetDb } from '../helpers/reset-db';

// A2 Real-Time Availability Check: "Before confirming, check for the availability of both a
// ServiceBay and a qualified Technician for the entire service duration."
// All bookings are on Tue 13 Oct 2026 in Europe/London (BST, +01:00); the dealership opens
// weekdays 08:00–18:00. Local 10:00 is 09:00Z.

describe('A2 availability check: bay and qualified technician free for the whole duration', () => {
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

  const at = (localTime: string) => new Date(`2026-10-13T${localTime}:00+01:00`);

  async function brakeScenario() {
    const dealership = await createDealership(db, { timeZone: 'Europe/London' });
    const brakeReplacement = await createServiceType(db, {
      code: 'BRAKE_REPLACEMENT',
      durationMinutes: 120,
      qualification: 'BRAKES',
    });
    return { dealership, brakeReplacement };
  }

  /** Occupies a bay and technician with a CONFIRMED appointment for another customer. */
  async function occupy(
    dealership: DealershipFixture,
    serviceType: ServiceTypeFixture,
    resources: { bayId: string; technicianId: string },
    from: string,
    to: string,
  ): Promise<string> {
    const other = await createCustomerWithVehicle(db);
    return insertAppointment(db, {
      dealershipId: dealership.id,
      customerId: other.customerId,
      vehicleId: other.vehicleId,
      serviceTypeId: serviceType.id,
      serviceBayId: resources.bayId,
      technicianId: resources.technicianId,
      startsAt: at(from),
      endsAt: at(to),
    });
  }

  async function book(
    dealership: DealershipFixture,
    serviceType: ServiceTypeFixture,
    customer: { customerId: string; vehicleId: string },
    localStart: string,
  ) {
    return request(app.getHttpServer())
      .post('/appointments')
      .send({
        dealershipId: dealership.id,
        customerId: customer.customerId,
        vehicleId: customer.vehicleId,
        serviceTypeId: serviceType.id,
        startsAt: `2026-10-13T${localStart}:00+01:00`,
      });
  }

  const appointmentCount = async () =>
    Number(
      (
        await db
          .selectFrom('appointment')
          .select((eb) => eb.fn.countAll().as('n'))
          .executeTakeFirstOrThrow()
      ).n,
    );

  it('AT-A2-01 assigns the EV-qualified technician for an EV battery check', async () => {
    const dealership = await createDealership(db, { timeZone: 'Europe/London' });
    await createBays(db, dealership.id, 1);
    // The general technician sorts first by name, so first-fit without the
    // qualification filter would pick the wrong one.
    await createTechnician(db, dealership.id, {
      name: 'Aaron General',
      qualifications: ['GENERAL'],
    });
    const evTechnician = await createTechnician(db, dealership.id, {
      name: 'Zoe Volt',
      qualifications: ['GENERAL', 'EV_HIGH_VOLTAGE'],
    });
    const evCheck = await createServiceType(db, {
      code: 'EV_BATTERY_CHECK',
      durationMinutes: 90,
      qualification: 'EV_HIGH_VOLTAGE',
    });
    const customer = await createCustomerWithVehicle(db);

    const res = await book(dealership, evCheck, customer, '10:00');

    expect(res.status).toBe(201);
    expect(res.body.technician).toEqual({ id: evTechnician.id, name: 'Zoe Volt' });
  });

  it('AT-A2-02 returns 409 SLOT_UNAVAILABLE when every bay is busy for part of the period', async () => {
    const { dealership, brakeReplacement } = await brakeScenario();
    const [bay1, bay2] = await createBays(db, dealership.id, 2);
    await createTechnician(db, dealership.id, { name: 'Alex Brakes', qualifications: ['BRAKES'] });
    await createTechnician(db, dealership.id, { name: 'Blair Brakes', qualifications: ['BRAKES'] });
    const occupier = await createTechnician(db, dealership.id, {
      name: 'Owen Other',
      qualifications: ['GENERAL'],
    });
    // Requested 10:00–12:00. Bay 1 is busy over the start, bay 2 over the end.
    await occupy(
      dealership,
      brakeReplacement,
      { bayId: bay1!.id, technicianId: occupier.id },
      '09:00',
      '10:30',
    );
    await occupy(
      dealership,
      brakeReplacement,
      { bayId: bay2!.id, technicianId: occupier.id },
      '11:30',
      '12:30',
    );
    const customer = await createCustomerWithVehicle(db);

    const res = await book(dealership, brakeReplacement, customer, '10:00');

    expectProblem(res, 409, 'SLOT_UNAVAILABLE');
    expect(await appointmentCount()).toBe(2);
  });

  it('AT-A2-03 returns 409 SLOT_UNAVAILABLE when the only qualified technician is busy for the last 30 minutes', async () => {
    const { dealership, brakeReplacement } = await brakeScenario();
    const [bay1] = await createBays(db, dealership.id, 2);
    const brakesTechnician = await createTechnician(db, dealership.id, {
      name: 'Alex Brakes',
      qualifications: ['BRAKES'],
    });
    // Requested 10:00–12:00; the technician is busy 11:30–12:30, so only the last
    // 30 minutes overlap. Bay 2 stays free for the whole period.
    await occupy(
      dealership,
      brakeReplacement,
      { bayId: bay1!.id, technicianId: brakesTechnician.id },
      '11:30',
      '12:30',
    );
    const customer = await createCustomerWithVehicle(db);

    const res = await book(dealership, brakeReplacement, customer, '10:00');

    expectProblem(res, 409, 'SLOT_UNAVAILABLE');
    expect(await appointmentCount()).toBe(1);
  });

  it('AT-A2-04 returns 409 when only an unqualified technician is free, and never assigns them', async () => {
    const { dealership, brakeReplacement } = await brakeScenario();
    const [bay1] = await createBays(db, dealership.id, 2);
    const brakesTechnician = await createTechnician(db, dealership.id, {
      name: 'Alex Brakes',
      qualifications: ['BRAKES'],
    });
    const generalTechnician = await createTechnician(db, dealership.id, {
      name: 'Gale General',
      qualifications: ['GENERAL'],
    });
    await occupy(
      dealership,
      brakeReplacement,
      { bayId: bay1!.id, technicianId: brakesTechnician.id },
      '10:00',
      '12:00',
    );
    const customer = await createCustomerWithVehicle(db);

    const res = await book(dealership, brakeReplacement, customer, '10:00');

    expectProblem(res, 409, 'SLOT_UNAVAILABLE');
    const assignedToGeneral = await db
      .selectFrom('appointment')
      .select('id')
      .where('technician_id', '=', generalTechnician.id)
      .execute();
    expect(assignedToGeneral).toEqual([]);
  });

  it('AT-A2-05 books a period that starts exactly when the only bay and technician become free', async () => {
    const { dealership, brakeReplacement } = await brakeScenario();
    const [bay] = await createBays(db, dealership.id, 1);
    const technician = await createTechnician(db, dealership.id, {
      name: 'Alex Brakes',
      qualifications: ['BRAKES'],
    });
    const resources = { bayId: bay!.id, technicianId: technician.id };
    // Busy until 10:00 and again from 12:00: the requested 10:00–12:00 fits exactly.
    await occupy(dealership, brakeReplacement, resources, '08:00', '10:00');
    await occupy(dealership, brakeReplacement, resources, '12:00', '14:00');
    const customer = await createCustomerWithVehicle(db);

    const res = await book(dealership, brakeReplacement, customer, '10:00');

    expect(res.status).toBe(201);
    expect(res.body.serviceBay.id).toBe(bay!.id);
    expect(res.body.technician.id).toBe(technician.id);
  });

  it('AT-A2-06 books over a CANCELLED appointment inserted directly', async () => {
    const { dealership, brakeReplacement } = await brakeScenario();
    const [bay] = await createBays(db, dealership.id, 1);
    const technician = await createTechnician(db, dealership.id, { qualifications: ['BRAKES'] });
    const customer = await createCustomerWithVehicle(db);
    // Same bay, technician and vehicle, same period, but CANCELLED: it blocks nothing.
    await insertAppointment(db, {
      dealershipId: dealership.id,
      customerId: customer.customerId,
      vehicleId: customer.vehicleId,
      serviceTypeId: brakeReplacement.id,
      serviceBayId: bay!.id,
      technicianId: technician.id,
      startsAt: at('10:00'),
      endsAt: at('12:00'),
      status: 'CANCELLED',
    });

    const res = await book(dealership, brakeReplacement, customer, '10:00');

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('CONFIRMED');
  });

  it('AT-A2-07 returns 409 VEHICLE_ALREADY_BOOKED for the same vehicle in an overlapping period', async () => {
    const { dealership, brakeReplacement } = await brakeScenario();
    await createBays(db, dealership.id, 2);
    await createTechnician(db, dealership.id, { name: 'Alex Brakes', qualifications: ['BRAKES'] });
    await createTechnician(db, dealership.id, { name: 'Blair Brakes', qualifications: ['BRAKES'] });
    const customer = await createCustomerWithVehicle(db);

    const first = await book(dealership, brakeReplacement, customer, '10:00');
    expect(first.status).toBe(201);

    // A second bay and technician are free, so only the vehicle rule can reject this.
    const second = await book(dealership, brakeReplacement, customer, '11:00');

    expectProblem(second, 409, 'VEHICLE_ALREADY_BOOKED');
    expect(await appointmentCount()).toBe(1);
  });
});
