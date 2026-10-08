import { type Kysely, sql } from 'kysely';
import type { Database } from '../../src/infrastructure/database/database.types';
import {
  createBay,
  createCustomerWithVehicle,
  createDealership,
  createServiceType,
  createTechnician,
  insertAppointment,
} from '../helpers/factories';
import { createTestDb, resetDb } from '../helpers/reset-db';

// The database is the no-overlap guarantee (ADR-001). These tests write rows directly,
// with no application code in between.

const at = (hhmm: string) => new Date(`2026-10-13T${hhmm}:00Z`);

describe('appointment table constraints', () => {
  let db: Kysely<Database>;

  beforeAll(() => {
    db = createTestDb();
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await resetDb(db);
  });

  async function world() {
    const dealership = await createDealership(db);
    const serviceType = await createServiceType(db);
    const bay1 = await createBay(db, dealership.id, 'Bay 1');
    const bay2 = await createBay(db, dealership.id, 'Bay 2');
    const tech1 = await createTechnician(db, dealership.id);
    const tech2 = await createTechnician(db, dealership.id);
    const alice = await createCustomerWithVehicle(db);
    const bob = await createCustomerWithVehicle(db);

    const row = (
      overrides: Partial<Parameters<typeof insertAppointment>[1]> & { from: string; to: string },
    ) => {
      const { from, to, ...rest } = overrides;
      return insertAppointment(db, {
        dealershipId: dealership.id,
        customerId: alice.customerId,
        vehicleId: alice.vehicleId,
        serviceTypeId: serviceType.id,
        serviceBayId: bay1.id,
        technicianId: tech1.id,
        startsAt: at(from),
        endsAt: at(to),
        ...rest,
      });
    };
    return { dealership, serviceType, bay1, bay2, tech1, tech2, alice, bob, row };
  }

  it('IT-01 rejects overlapping CONFIRMED rows on one bay with 23P01 on appointment_no_bay_overlap', async () => {
    const w = await world();
    await w.row({ from: '10:00', to: '12:00' });

    await expect(
      w.row({
        from: '11:00',
        to: '13:00',
        technicianId: w.tech2.id,
        customerId: w.bob.customerId,
        vehicleId: w.bob.vehicleId,
      }),
    ).rejects.toMatchObject({ code: '23P01', constraint: 'appointment_no_bay_overlap' });
  });

  it('IT-02 rejects overlapping CONFIRMED rows for one technician with 23P01 on appointment_no_technician_overlap', async () => {
    const w = await world();
    await w.row({ from: '10:00', to: '12:00' });

    await expect(
      w.row({
        from: '11:00',
        to: '13:00',
        serviceBayId: w.bay2.id,
        customerId: w.bob.customerId,
        vehicleId: w.bob.vehicleId,
      }),
    ).rejects.toMatchObject({ code: '23P01', constraint: 'appointment_no_technician_overlap' });
  });

  it('IT-03 rejects overlapping CONFIRMED rows for one vehicle with 23P01 on appointment_no_vehicle_overlap', async () => {
    const w = await world();
    await w.row({ from: '10:00', to: '12:00' });

    await expect(
      w.row({ from: '11:00', to: '13:00', serviceBayId: w.bay2.id, technicianId: w.tech2.id }),
    ).rejects.toMatchObject({ code: '23P01', constraint: 'appointment_no_vehicle_overlap' });
  });

  it('IT-04 accepts back-to-back rows on the same bay and technician', async () => {
    const w = await world();
    await w.row({ from: '10:00', to: '12:00' });

    await expect(
      w.row({
        from: '12:00',
        to: '14:00',
        customerId: w.bob.customerId,
        vehicleId: w.bob.vehicleId,
      }),
    ).resolves.toEqual(expect.any(String));
    await expect(
      w.row({
        from: '08:00',
        to: '10:00',
        customerId: w.bob.customerId,
        vehicleId: w.bob.vehicleId,
      }),
    ).resolves.toEqual(expect.any(String));
  });

  it('IT-05 accepts a row overlapping a CANCELLED row', async () => {
    const w = await world();
    await w.row({ from: '10:00', to: '12:00', status: 'CANCELLED' });

    await expect(w.row({ from: '10:00', to: '12:00' })).resolves.toEqual(expect.any(String));
  });

  it('IT-06 rejects a bay from another dealership with 23503 on appointment_bay_same_dealership', async () => {
    const w = await world();
    const otherDealership = await createDealership(db);
    const foreignBay = await createBay(db, otherDealership.id, 'Bay 1');

    await expect(
      w.row({ from: '10:00', to: '12:00', serviceBayId: foreignBay.id }),
    ).rejects.toMatchObject({ code: '23503', constraint: 'appointment_bay_same_dealership' });
  });

  it('IT-06 rejects a technician from another dealership with 23503 on appointment_technician_same_dealership', async () => {
    const w = await world();
    const otherDealership = await createDealership(db);
    const foreignTechnician = await createTechnician(db, otherDealership.id);

    await expect(
      w.row({ from: '10:00', to: '12:00', technicianId: foreignTechnician.id }),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'appointment_technician_same_dealership',
    });
  });

  it('IT-08 rejects a period with an inclusive upper bound via appointment_period_half_open', async () => {
    const w = await world();

    await expect(
      db
        .insertInto('appointment')
        .values({
          dealership_id: w.dealership.id,
          customer_id: w.alice.customerId,
          vehicle_id: w.alice.vehicleId,
          service_type_id: w.serviceType.id,
          service_bay_id: w.bay1.id,
          technician_id: w.tech1.id,
          period: sql<string>`tstzrange(${at('10:00')}::timestamptz, ${at('12:00')}::timestamptz, '[]')`,
        })
        .execute(),
    ).rejects.toMatchObject({ code: '23514', constraint: 'appointment_period_half_open' });
  });

  it('rejects CANCELLED without cancelled_at via appointment_cancelled_at_matches_status', async () => {
    const w = await world();
    const id = await w.row({ from: '10:00', to: '12:00' });

    await expect(
      db.updateTable('appointment').set({ status: 'CANCELLED' }).where('id', '=', id).execute(),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'appointment_cancelled_at_matches_status',
    });
  });
});
