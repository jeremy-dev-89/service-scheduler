import { BookAppointmentUseCase } from '../../src/application/book-appointment.use-case';
import type {
  AppointmentRepository,
  BookingContext,
  BookingDecision,
  BookingPolicy,
  BookingTelemetry,
  IdempotencyRecord,
  NewAppointment,
  SchedulingRepository,
} from '../../src/application/ports';
import {
  IdempotencyKeyConflictError,
  InsertDeadlockError,
  ResourceConflictError,
} from '../../src/domain/errors';
import type { Period } from '../../src/domain/period';
import type { Appointment, ResourceBooking, ServiceBay, Technician } from '../../src/domain/types';

// The retry loop in isolation: scripted insert outcomes instead of real races.

const NOW = new Date('2026-10-12T09:00:00Z');
const STARTS_AT = new Date('2026-10-13T09:00:00Z'); // Tue 10:00 in London

const technicians: Technician[] = [
  { id: 't1', name: 'Alex' },
  { id: 't2', name: 'Blair' },
];
const bays: ServiceBay[] = [
  { id: 'b1', name: 'Bay 1' },
  { id: 'b2', name: 'Bay 2' },
];

const context: BookingContext = {
  dealership: {
    id: 'd1',
    name: 'Test Motors',
    timeZone: 'Europe/London',
    openingHours: [1, 2, 3, 4, 5].map((isoDayOfWeek) => ({
      isoDayOfWeek,
      opensAt: '08:00',
      closesAt: '18:00',
    })),
  },
  customer: { id: 'c1', fullName: 'Robin' },
  vehicle: { id: 'v1', customerId: 'c1', vin: 'VIN', make: 'Make', model: 'Model' },
  serviceType: {
    id: 's1',
    code: 'OIL',
    name: 'Oil',
    durationMinutes: 60,
    requiredQualificationCode: 'GENERAL',
  },
};

class FakeScheduling implements SchedulingRepository {
  loadBookingContext = jest.fn(async (): Promise<BookingContext> => context);
  findDealership = jest.fn(async () => context.dealership);
  findServiceType = jest.fn(async () => context.serviceType);
  findFreeQualifiedTechnicians = jest.fn(async () => technicians);
  findFreeBays = jest.fn(async () => bays);
  vehicleHasOverlap = jest.fn(async () => false);
  findConfirmedBookings = jest.fn(async (): Promise<ResourceBooking[]> => []);
  findVehicleBusyPeriods = jest.fn(async (): Promise<Period[]> => []);
  listBays = jest.fn(async () => bays);
  listQualifiedTechnicians = jest.fn(async () => technicians);
}

/** Each insert takes the next scripted outcome: an error to throw, or success. */
class ScriptedAppointments implements AppointmentRepository {
  readonly inserts: NewAppointment[] = [];
  readonly stored = new Map<string, Appointment>();
  idempotency: IdempotencyRecord | undefined;

  constructor(private readonly script: Array<Error | 'ok'>) {}

  async insertConfirmed(appointment: NewAppointment): Promise<string> {
    this.inserts.push(appointment);
    const outcome = this.script.shift() ?? 'ok';
    if (outcome instanceof Error) {
      throw outcome;
    }
    const id = `a${this.inserts.length}`;
    this.stored.set(id, {
      id,
      status: 'CONFIRMED',
      period: appointment.period,
      dealership: { id: 'd1', name: 'Test Motors', timeZone: 'Europe/London' },
      customer: { id: 'c1', fullName: 'Robin' },
      vehicle: { id: 'v1', vin: 'VIN', make: 'Make', model: 'Model' },
      serviceType: { id: 's1', code: 'OIL', name: 'Oil', durationMinutes: 60 },
      serviceBay: bays.find((b) => b.id === appointment.serviceBayId)!,
      technician: technicians.find((t) => t.id === appointment.technicianId)!,
      createdAt: NOW,
    });
    return id;
  }

  async findById(id: string): Promise<Appointment | undefined> {
    return this.stored.get(id);
  }

  async findByIdempotencyKey(): Promise<IdempotencyRecord | undefined> {
    return this.idempotency;
  }

  async cancel(): Promise<void> {}
}

class RecordingTelemetry implements BookingTelemetry {
  readonly retries: string[] = [];
  readonly decisions: BookingDecision[] = [];

  span<T>(_n: string, _a: object, work: (set: () => void) => Promise<T>): Promise<T> {
    return work(() => undefined);
  }

  conflictRetry(resource: 'bay' | 'technician'): void {
    this.retries.push(resource);
  }

  bookingDecided(decision: BookingDecision): void {
    this.decisions.push(decision);
  }
}

const policy: BookingPolicy = {
  horizonDays: 90,
  maxAttempts: 5,
  slotStepMinutes: 15,
  alternativesCount: 3,
  alternativesSearchDays: 7,
};

function setup(script: Array<Error | 'ok'>, overrides: Partial<BookingPolicy> = {}) {
  const scheduling = new FakeScheduling();
  const appointments = new ScriptedAppointments(script);
  const telemetry = new RecordingTelemetry();
  const useCase = new BookAppointmentUseCase(
    scheduling,
    appointments,
    { now: () => NOW },
    { ...policy, ...overrides },
    telemetry,
  );
  const book = (idempotency?: { key: string; fingerprint: string }) =>
    useCase.execute({
      dealershipId: 'd1',
      customerId: 'c1',
      vehicleId: 'v1',
      serviceTypeId: 's1',
      startsAt: STARTS_AT,
      ...(idempotency ? { idempotency } : {}),
    });
  const pairs = () => appointments.inserts.map((i) => `${i.technicianId}/${i.serviceBayId}`);
  return { scheduling, appointments, telemetry, book, pairs };
}

const bayTaken = () => new ResourceConflictError('bay', 'appointment_no_bay_overlap');
const technicianTaken = () =>
  new ResourceConflictError('technician', 'appointment_no_technician_overlap');
const vehicleTaken = () => new ResourceConflictError('vehicle', 'appointment_no_vehicle_overlap');

describe('BookAppointmentUseCase retry loop', () => {
  it('books the first technician with the first bay when the insert succeeds', async () => {
    const t = setup(['ok']);

    const result = await t.book();

    expect(t.pairs()).toEqual(['t1/b1']);
    expect(result).toMatchObject({ replayed: false, appointment: { id: 'a1' } });
    expect(t.telemetry.decisions).toEqual([
      expect.objectContaining({ outcome: 'confirmed', retries: 0, appointmentId: 'a1' }),
    ]);
  });

  it('excludes a bay that lost the race and keeps the technician', async () => {
    const t = setup([bayTaken(), 'ok']);

    await t.book();

    expect(t.pairs()).toEqual(['t1/b1', 't1/b2']);
    expect(t.telemetry.retries).toEqual(['bay']);
  });

  it('excludes a technician that lost the race and keeps the bay', async () => {
    const t = setup([technicianTaken(), 'ok']);

    await t.book();

    expect(t.pairs()).toEqual(['t1/b1', 't2/b1']);
    expect(t.telemetry.retries).toEqual(['technician']);
  });

  it('answers VEHICLE_ALREADY_BOOKED when the vehicle constraint rejects the insert', async () => {
    const t = setup([vehicleTaken()]);

    await expect(t.book()).rejects.toMatchObject({ code: 'VEHICLE_ALREADY_BOOKED' });
    expect(t.pairs()).toEqual(['t1/b1']);
    expect(t.telemetry.decisions[0]).toMatchObject({ outcome: 'vehicle_already_booked' });
  });

  it('retries the same pair after a deadlock, without counting a resource conflict', async () => {
    const t = setup([new InsertDeadlockError(), 'ok']);

    await t.book();

    expect(t.pairs()).toEqual(['t1/b1', 't1/b1']);
    expect(t.telemetry.retries).toEqual([]);
    expect(t.telemetry.decisions[0]).toMatchObject({ outcome: 'confirmed', retries: 1 });
  });

  it('answers SLOT_UNAVAILABLE once no pair is left', async () => {
    const t = setup([bayTaken(), technicianTaken(), bayTaken()]);

    await expect(t.book()).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    expect(t.pairs()).toEqual(['t1/b1', 't1/b2', 't2/b2']);
    expect(t.telemetry.decisions[0]).toMatchObject({ outcome: 'slot_unavailable', retries: 3 });
  });

  it('stops after BOOKING_MAX_ATTEMPTS inserts even if pairs remain', async () => {
    const t = setup(
      Array.from({ length: 10 }, () => new InsertDeadlockError()),
      {
        maxAttempts: 3,
      },
    );

    await expect(t.book()).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    expect(t.appointments.inserts).toHaveLength(3);
  });

  it('does not insert when the vehicle fast path finds an overlap', async () => {
    const t = setup([]);
    t.scheduling.vehicleHasOverlap.mockResolvedValue(true);

    await expect(t.book()).rejects.toMatchObject({ code: 'VEHICLE_ALREADY_BOOKED' });
    expect(t.appointments.inserts).toHaveLength(0);
  });

  it('rethrows an unexpected error and records the outcome as error', async () => {
    const t = setup([new Error('connection lost')]);

    await expect(t.book()).rejects.toThrow('connection lost');
    expect(t.telemetry.decisions[0]).toMatchObject({
      outcome: 'error',
      errorCode: 'INTERNAL_ERROR',
    });
  });

  it('reads the clock only through the Clock port', async () => {
    const t = setup(['ok']);
    const pastNow = new Date('2026-10-13T09:30:00Z');
    const useCase = new BookAppointmentUseCase(
      t.scheduling,
      t.appointments,
      { now: () => pastNow },
      policy,
      t.telemetry,
    );

    await expect(
      useCase.execute({
        dealershipId: 'd1',
        customerId: 'c1',
        vehicleId: 'v1',
        serviceTypeId: 's1',
        startsAt: STARTS_AT,
      }),
    ).rejects.toMatchObject({ code: 'START_IN_PAST' });
  });
});

describe('BookAppointmentUseCase idempotency', () => {
  const key = { key: 'k1', fingerprint: 'f1' };

  it('stores the key and fingerprint with the insert', async () => {
    const t = setup(['ok']);

    await t.book(key);

    expect(t.appointments.inserts[0]).toMatchObject({
      idempotencyKey: 'k1',
      idempotencyFingerprint: 'f1',
    });
  });

  it('replays a stored appointment without inserting', async () => {
    const t = setup(['ok']);
    await t.book(key);
    t.appointments.idempotency = { appointmentId: 'a1', fingerprint: 'f1' };

    const replay = await t.book(key);

    expect(replay).toMatchObject({ replayed: true, appointment: { id: 'a1' } });
    expect(t.appointments.inserts).toHaveLength(1);
  });

  it('answers IDEMPOTENCY_KEY_REUSED when the stored fingerprint differs', async () => {
    const t = setup([]);
    t.appointments.idempotency = { appointmentId: 'a1', fingerprint: 'other' };

    await expect(t.book(key)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('goes back to step 0 after losing the race on the idempotency key', async () => {
    const t = setup(['ok']);
    await t.book({ key: 'k1', fingerprint: 'f1' }); // the winner's row, a1
    const loser = new ScriptedAppointments([new IdempotencyKeyConflictError()]);
    loser.stored.set('a1', t.appointments.stored.get('a1')!);
    let lookups = 0;
    loser.findByIdempotencyKey = async () =>
      lookups++ === 0 ? undefined : { appointmentId: 'a1', fingerprint: 'f1' };
    const useCase = new BookAppointmentUseCase(
      new FakeScheduling(),
      loser,
      { now: () => NOW },
      policy,
      new RecordingTelemetry(),
    );

    const result = await useCase.execute({
      dealershipId: 'd1',
      customerId: 'c1',
      vehicleId: 'v1',
      serviceTypeId: 's1',
      startsAt: STARTS_AT,
      idempotency: key,
    });

    expect(result).toMatchObject({ replayed: true, appointment: { id: 'a1' } });
  });
});
