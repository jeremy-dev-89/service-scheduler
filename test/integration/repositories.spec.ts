import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import {
  IdempotencyKeyConflictError,
  InternalIntegrityError,
  ResourceConflictError,
} from '../../src/domain/errors';
import { Period } from '../../src/domain/period';
import type { Database } from '../../src/infrastructure/database/database.types';
import { KyselyAppointmentRepository } from '../../src/infrastructure/repositories/appointment.repository';
import { KyselySchedulingRepository } from '../../src/infrastructure/repositories/scheduling.repository';
import {
  createBay,
  createCustomerWithVehicle,
  createDealership,
  createServiceType,
  createTechnician,
  insertAppointment,
} from '../helpers/factories';
import { createTestDb, resetDb } from '../helpers/reset-db';

const at = (hhmm: string) => new Date(`2026-10-13T${hhmm}:00Z`);
const period = (from: string, to: string) => Period.between(at(from), at(to));

describe('Kysely repositories', () => {
  let db: Kysely<Database>;
  let appointments: KyselyAppointmentRepository;
  let scheduling: KyselySchedulingRepository;

  beforeAll(() => {
    db = createTestDb();
    appointments = new KyselyAppointmentRepository(db);
    scheduling = new KyselySchedulingRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await resetDb(db);
  });

  async function world() {
    const dealership = await createDealership(db, { name: 'Repo Motors' });
    const serviceType = await createServiceType(db, { qualification: 'BRAKES' });
    const bay1 = await createBay(db, dealership.id, 'Bay 1');
    const bay2 = await createBay(db, dealership.id, 'Bay 2');
    const tech1 = await createTechnician(db, dealership.id, { qualifications: ['BRAKES'] });
    const tech2 = await createTechnician(db, dealership.id, { qualifications: ['BRAKES'] });
    const alice = await createCustomerWithVehicle(db, { fullName: 'Alice Example' });
    const bob = await createCustomerWithVehicle(db);
    const booking = (
      overrides: Partial<Parameters<KyselyAppointmentRepository['insertConfirmed']>[0]> = {},
    ) => ({
      dealershipId: dealership.id,
      customerId: alice.customerId,
      vehicleId: alice.vehicleId,
      serviceTypeId: serviceType.id,
      serviceBayId: bay1.id,
      technicianId: tech1.id,
      period: period('10:00', '12:00'),
      ...overrides,
    });
    return { dealership, serviceType, bay1, bay2, tech1, tech2, alice, bob, booking };
  }

  describe('AppointmentRepository.insertConfirmed', () => {
    it.each([
      ['bay', 'appointment_no_bay_overlap', 'sameBay'],
      ['technician', 'appointment_no_technician_overlap', 'sameTechnician'],
      ['vehicle', 'appointment_no_vehicle_overlap', 'sameVehicle'],
    ] as const)(
      'IT-07 maps a lost race on the %s constraint to a ResourceConflictError naming that resource',
      async (resource, constraint, clash) => {
        const w = await world();
        await appointments.insertConfirmed(w.booking());
        const other = { customerId: w.bob.customerId, vehicleId: w.bob.vehicleId };
        const second = {
          sameBay: w.booking({ ...other, technicianId: w.tech2.id }),
          sameTechnician: w.booking({ ...other, serviceBayId: w.bay2.id }),
          sameVehicle: w.booking({ serviceBayId: w.bay2.id, technicianId: w.tech2.id }),
        }[clash];

        const error = await appointments.insertConfirmed(second).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ResourceConflictError);
        expect(error).toMatchObject({ resource, constraint });
      },
    );

    it('maps a lost race on the idempotency key to an IdempotencyKeyConflictError', async () => {
      const w = await world();
      await appointments.insertConfirmed(
        w.booking({ idempotencyKey: 'key-1', idempotencyFingerprint: 'f' }),
      );

      const error = await appointments
        .insertConfirmed(
          w.booking({
            customerId: w.bob.customerId,
            vehicleId: w.bob.vehicleId,
            serviceBayId: w.bay2.id,
            technicianId: w.tech2.id,
            idempotencyKey: 'key-1',
            idempotencyFingerprint: 'f',
          }),
        )
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(IdempotencyKeyConflictError);
    });

    it('maps a 23503 to an InternalIntegrityError', async () => {
      const w = await world();
      const otherDealership = await createDealership(db);
      const foreignBay = await createBay(db, otherDealership.id, 'Bay 1');

      const error = await appointments
        .insertConfirmed(w.booking({ serviceBayId: foreignBay.id }))
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InternalIntegrityError);
      expect(error).toMatchObject({ code: 'INTERNAL_ERROR' });
    });

    it('stores a half-open period and reads the appointment back with its associations', async () => {
      const w = await world();
      const id = await appointments.insertConfirmed(w.booking());

      const appointment = await appointments.findById(id);

      expect(appointment).toMatchObject({
        id,
        status: 'CONFIRMED',
        dealership: { id: w.dealership.id, name: 'Repo Motors', timeZone: 'Europe/London' },
        customer: { id: w.alice.customerId, fullName: 'Alice Example' },
        vehicle: { id: w.alice.vehicleId, vin: w.alice.vin },
        serviceType: { id: w.serviceType.id, durationMinutes: 60 },
        serviceBay: { id: w.bay1.id, name: 'Bay 1' },
        technician: { id: w.tech1.id },
      });
      expect(appointment?.period.start).toEqual(at('10:00'));
      expect(appointment?.period.end).toEqual(at('12:00'));
      expect(await appointments.findById(randomUUID())).toBeUndefined();
    });
  });

  describe('AppointmentRepository.cancel and findByIdempotencyKey', () => {
    it('cancels once and leaves an already cancelled appointment unchanged', async () => {
      const w = await world();
      const id = await appointments.insertConfirmed(w.booking());

      await appointments.cancel(id, at('09:00'));
      await appointments.cancel(id, at('09:30'));

      const row = await db
        .selectFrom('appointment')
        .select(['status', 'cancelled_at'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ status: 'CANCELLED', cancelled_at: at('09:00') });
    });

    it('finds an appointment by idempotency key with its fingerprint', async () => {
      const w = await world();
      const id = await appointments.insertConfirmed(
        w.booking({ idempotencyKey: 'key-2', idempotencyFingerprint: 'abc' }),
      );

      expect(await appointments.findByIdempotencyKey('key-2')).toEqual({
        appointmentId: id,
        fingerprint: 'abc',
      });
      expect(await appointments.findByIdempotencyKey('missing')).toBeUndefined();
    });
  });

  describe('SchedulingRepository candidate queries', () => {
    it('IT-09 returns only free, qualified technicians and free bays, ordered by name then ID', async () => {
      const dealership = await createDealership(db);
      const otherDealership = await createDealership(db);
      const serviceType = await createServiceType(db, { qualification: 'BRAKES' });

      // Technicians: two named "Bea" to prove the id tie-break.
      const beaA = await createTechnician(db, dealership.id, {
        name: 'Bea',
        qualifications: ['BRAKES'],
      });
      const beaB = await createTechnician(db, dealership.id, {
        name: 'Bea',
        qualifications: ['BRAKES'],
      });
      const amy = await createTechnician(db, dealership.id, {
        name: 'Amy',
        qualifications: ['GENERAL', 'BRAKES'],
      });
      const busyAl = await createTechnician(db, dealership.id, {
        name: 'Al',
        qualifications: ['BRAKES'],
      });
      await createTechnician(db, dealership.id, { name: 'Cy', qualifications: ['GENERAL'] });
      await createTechnician(db, otherDealership.id, { name: 'Abe', qualifications: ['BRAKES'] });
      const cancelledDan = await createTechnician(db, dealership.id, {
        name: 'Dan',
        qualifications: ['BRAKES'],
      });
      const adjacentEve = await createTechnician(db, dealership.id, {
        name: 'Eve',
        qualifications: ['BRAKES'],
      });

      // Bays: one busy, one with only a cancelled booking, one with an adjacent booking.
      const bayC = await createBay(db, dealership.id, 'C bay');
      const bayA = await createBay(db, dealership.id, 'A bay');
      const busyBay = await createBay(db, dealership.id, 'B bay');
      await createBay(db, otherDealership.id, 'A bay'); // another dealership: never returned

      const occupy = (
        bayId: string,
        technicianId: string,
        from: string,
        to: string,
        status: 'CONFIRMED' | 'CANCELLED' = 'CONFIRMED',
      ) =>
        createCustomerWithVehicle(db).then((c) =>
          insertAppointment(db, {
            dealershipId: dealership.id,
            customerId: c.customerId,
            vehicleId: c.vehicleId,
            serviceTypeId: serviceType.id,
            serviceBayId: bayId,
            technicianId: technicianId,
            startsAt: at(from),
            endsAt: at(to),
            status,
          }),
        );
      await occupy(busyBay.id, busyAl.id, '11:00', '11:30'); // overlaps: Al and B bay busy
      await occupy(bayC.id, cancelledDan.id, '10:00', '12:00', 'CANCELLED'); // blocks nothing
      await occupy(bayA.id, adjacentEve.id, '08:00', '10:00'); // ends when the request starts

      const requested = period('10:00', '12:00');
      const technicians = await scheduling.findFreeQualifiedTechnicians(
        dealership.id,
        'BRAKES',
        requested,
      );
      const bays = await scheduling.findFreeBays(dealership.id, requested);

      const [firstBea, secondBea] = [beaA, beaB].sort((x, y) => x.id.localeCompare(y.id));
      expect(technicians).toEqual([
        { id: amy.id, name: 'Amy' },
        { id: firstBea!.id, name: 'Bea' },
        { id: secondBea!.id, name: 'Bea' },
        { id: cancelledDan.id, name: 'Dan' },
        { id: adjacentEve.id, name: 'Eve' },
      ]);
      expect(bays).toEqual([
        { id: bayA.id, name: 'A bay' },
        { id: bayC.id, name: 'C bay' },
      ]);
    });

    it('loads the booking context, with opening hours, and undefined for unknown records', async () => {
      const w = await world();

      const context = await scheduling.loadBookingContext({
        dealershipId: w.dealership.id,
        customerId: w.alice.customerId,
        vehicleId: w.alice.vehicleId,
        serviceTypeId: w.serviceType.id,
      });

      expect(context.dealership?.openingHours).toEqual([
        { isoDayOfWeek: 1, opensAt: '08:00:00', closesAt: '18:00:00' },
        { isoDayOfWeek: 2, opensAt: '08:00:00', closesAt: '18:00:00' },
        { isoDayOfWeek: 3, opensAt: '08:00:00', closesAt: '18:00:00' },
        { isoDayOfWeek: 4, opensAt: '08:00:00', closesAt: '18:00:00' },
        { isoDayOfWeek: 5, opensAt: '08:00:00', closesAt: '18:00:00' },
      ]);
      expect(context.customer).toEqual({ id: w.alice.customerId, fullName: 'Alice Example' });
      expect(context.vehicle).toMatchObject({
        id: w.alice.vehicleId,
        customerId: w.alice.customerId,
      });
      expect(context.serviceType).toMatchObject({
        id: w.serviceType.id,
        requiredQualificationCode: 'BRAKES',
      });

      const unknown = await scheduling.loadBookingContext({
        dealershipId: randomUUID(),
        customerId: randomUUID(),
        vehicleId: randomUUID(),
        serviceTypeId: randomUUID(),
      });
      expect(unknown).toEqual({
        dealership: undefined,
        customer: undefined,
        vehicle: undefined,
        serviceType: undefined,
      });
    });

    it('reports vehicle overlaps and confirmed bookings in a window, ignoring cancelled rows', async () => {
      const w = await world();
      await appointments.insertConfirmed(w.booking());
      const cancelledId = await appointments.insertConfirmed(
        w.booking({
          period: period('13:00', '14:00'),
          serviceBayId: w.bay2.id,
          technicianId: w.tech2.id,
        }),
      );
      await appointments.cancel(cancelledId, at('09:00'));

      expect(await scheduling.vehicleHasOverlap(w.alice.vehicleId, period('11:59', '13:00'))).toBe(
        true,
      );
      expect(await scheduling.vehicleHasOverlap(w.alice.vehicleId, period('12:00', '15:00'))).toBe(
        false,
      );

      const bookings = await scheduling.findConfirmedBookings(
        w.dealership.id,
        period('00:00', '23:59'),
      );
      expect(bookings).toHaveLength(1);
      expect(bookings[0]).toMatchObject({ serviceBayId: w.bay1.id, technicianId: w.tech1.id });
      expect(bookings[0]?.period.start).toEqual(at('10:00'));

      const busy = await scheduling.findVehicleBusyPeriods(
        w.alice.vehicleId,
        period('00:00', '23:59'),
      );
      expect(busy.map((p) => [p.start, p.end])).toEqual([[at('10:00'), at('12:00')]]);
    });
  });
});
