import { Inject, Injectable } from '@nestjs/common';
import { nextCandidatePair } from '../domain/allocation';
import { alternativesWindow, findAlternatives, latestBookableStart } from '../domain/availability';
import {
  BeyondBookingHorizonError,
  CustomerNotFoundError,
  DealershipNotFoundError,
  DomainError,
  IdempotencyKeyConflictError,
  IdempotencyKeyReusedError,
  TransientInsertError,
  InternalIntegrityError,
  OutsideOpeningHoursError,
  ResourceConflictError,
  ServiceTypeNotFoundError,
  SlotUnavailableError,
  StartInPastError,
  VehicleAlreadyBookedError,
  VehicleNotFoundError,
  VehicleNotOwnedByCustomerError,
} from '../domain/errors';
import { fitsWithinOpeningHours, formatLocal, toLocalClock } from '../domain/opening-hours';
import { Period } from '../domain/period';
import type {
  Appointment,
  Dealership,
  ServiceBay,
  ServiceType,
  Technician,
  Vehicle,
} from '../domain/types';
import {
  APPOINTMENT_REPOSITORY,
  type AppointmentRepository,
  BOOKING_POLICY,
  BOOKING_TELEMETRY,
  type BookingDecision,
  type BookingOutcome,
  type BookingPolicy,
  type BookingTelemetry,
  CLOCK,
  type Clock,
  SCHEDULING_REPOSITORY,
  type SchedulingRepository,
} from './ports';

/**
 * Retrying after an aborted insert (see TransientInsertError). When many requests race for
 * one slot, their inserts can all wait on each other and all be aborted together; if they
 * retry together they collide again. Full-jitter exponential backoff spreads them out until
 * one insert gets through alone, and the candidate re-read then stops the rest inserting.
 * The budget is separate from BOOKING_MAX_ATTEMPTS so an abort never becomes a false 409,
 * and bounds the worst case at roughly 15 × (lock timeout + 1 s).
 */
const MAX_ABORTED_INSERTS = 15;
const RETRY_BACKOFF_BASE_MS = 25;
const RETRY_BACKOFF_CAP_MS = 1_000;

const retryBackoffMs = (abortedSoFar: number): number =>
  Math.random() * Math.min(RETRY_BACKOFF_CAP_MS, RETRY_BACKOFF_BASE_MS * 2 ** abortedSoFar);

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface BookAppointmentCommand {
  readonly dealershipId: string;
  readonly customerId: string;
  readonly vehicleId: string;
  readonly serviceTypeId: string;
  readonly startsAt: Date;
  /** Present when the caller sent an Idempotency-Key header. */
  readonly idempotency?: {
    readonly key: string;
    /** SHA-256 of the request body as canonical JSON. */
    readonly fingerprint: string;
  };
}

export interface BookingResult {
  readonly appointment: Appointment;
  /** True when an earlier request with the same idempotency key already booked it. */
  readonly replayed: boolean;
}

interface ResolvedContext {
  readonly dealership: Dealership;
  readonly vehicle: Vehicle;
  readonly serviceType: ServiceType;
}

/**
 * A1 + A2: books a bay and a qualified technician for the whole service duration.
 *
 * Reads find candidates without locks; the INSERT is the decision. When an exclusion
 * constraint rejects the insert, another request won that bay or technician, so it is
 * excluded and the next pair is tried, at most `maxAttempts` times (ADR-001).
 */
@Injectable()
export class BookAppointmentUseCase {
  constructor(
    @Inject(SCHEDULING_REPOSITORY) private readonly scheduling: SchedulingRepository,
    @Inject(APPOINTMENT_REPOSITORY) private readonly appointments: AppointmentRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BOOKING_POLICY) private readonly policy: BookingPolicy,
    @Inject(BOOKING_TELEMETRY) private readonly telemetry: BookingTelemetry,
  ) {}

  async execute(command: BookAppointmentCommand): Promise<BookingResult> {
    const startedAt = performance.now();
    const progress = { retries: 0 };
    const attributes = {
      'dealership.id': command.dealershipId,
      'service_type.id': command.serviceTypeId,
    };

    try {
      const result = await this.telemetry.span('booking.execute', attributes, () =>
        this.book(command, progress),
      );
      this.decided(command, startedAt, progress.retries, {
        outcome: 'confirmed',
        appointmentId: result.appointment.id,
      });
      return result;
    } catch (error) {
      this.decided(command, startedAt, progress.retries, describeFailure(error));
      throw error;
    }
  }

  private async book(
    command: BookAppointmentCommand,
    progress: { retries: number },
  ): Promise<BookingResult> {
    const { idempotency } = command;
    if (!idempotency) {
      return this.bookNew(command, progress);
    }

    // 0. A request with this key was already booked: replay it.
    const earlier = await this.replay(idempotency);
    if (earlier) {
      return earlier;
    }
    try {
      return await this.bookNew(command, progress);
    } catch (error) {
      // Lost a race to a request with the same key: its row either took the key (23505)
      // or took the vehicle, bay or technician this request wanted. Go back to step 0.
      if (
        error instanceof IdempotencyKeyConflictError ||
        error instanceof VehicleAlreadyBookedError ||
        error instanceof SlotUnavailableError
      ) {
        const winner = await this.replay(idempotency);
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }

  private async replay(idempotency: {
    key: string;
    fingerprint: string;
  }): Promise<BookingResult | undefined> {
    const stored = await this.appointments.findByIdempotencyKey(idempotency.key);
    if (!stored) {
      return undefined;
    }
    if (stored.fingerprint !== idempotency.fingerprint) {
      throw new IdempotencyKeyReusedError();
    }
    return { appointment: await this.loadAppointment(stored.appointmentId), replayed: true };
  }

  private async bookNew(
    command: BookAppointmentCommand,
    progress: { retries: number },
  ): Promise<BookingResult> {
    // 1–2. Every referenced record exists, and the vehicle belongs to the customer.
    const { dealership, vehicle, serviceType } = await this.loadContext(command);

    // 3. The half-open period the service needs (AS8, AS12).
    const period = Period.of(command.startsAt, serviceType.durationMinutes);

    // 4–5. In the future, within the horizon and inside opening hours.
    this.assertBookableTime(period, dealership);

    // 6. Fast path for the vehicle rule (AS14). The constraint is the guarantee.
    if (await this.scheduling.vehicleHasOverlap(vehicle.id, period)) {
      throw new VehicleAlreadyBookedError(vehicle.id);
    }

    // 7. Candidates that look free right now, in first-fit order (AS9).
    let candidates = await this.freeCandidates(dealership, serviceType, period);

    // 8. Try pairs until an insert succeeds; each lost race excludes one resource.
    const excludedTechnicians = new Set<string>();
    const excludedBays = new Set<string>();
    let decided = 0;
    let aborted = 0;
    while (decided < this.policy.maxAttempts) {
      const pair = nextCandidatePair(
        candidates.technicians,
        candidates.bays,
        excludedTechnicians,
        excludedBays,
      );
      if (!pair) {
        break;
      }
      try {
        const appointmentId = await this.telemetry.span(
          'booking.insert_attempt',
          { attempt: decided + aborted + 1 },
          async (setAttributes) => {
            try {
              const id = await this.appointments.insertConfirmed({
                dealershipId: dealership.id,
                customerId: command.customerId,
                vehicleId: vehicle.id,
                serviceTypeId: serviceType.id,
                serviceBayId: pair.bay.id,
                technicianId: pair.technician.id,
                period,
                idempotencyKey: command.idempotency?.key,
                idempotencyFingerprint: command.idempotency?.fingerprint,
              });
              setAttributes({ outcome: 'inserted' });
              return id;
            } catch (error) {
              setAttributes({ outcome: insertOutcome(error) });
              throw error;
            }
          },
        );
        return { appointment: await this.loadAppointment(appointmentId), replayed: false };
      } catch (error) {
        if (error instanceof TransientInsertError) {
          // Aborted while waiting on another insert (deadlock victim or lock timeout):
          // nothing was written and nothing was decided. Back off, then re-read the
          // candidates so pairs already taken are skipped without another insert.
          aborted += 1;
          if (aborted > MAX_ABORTED_INSERTS) {
            throw error;
          }
          progress.retries += 1;
          await pause(retryBackoffMs(aborted));
          candidates = await this.freeCandidates(dealership, serviceType, period);
          continue;
        }
        if (!(error instanceof ResourceConflictError)) {
          throw error;
        }
        if (error.resource === 'vehicle') {
          throw new VehicleAlreadyBookedError(vehicle.id);
        }
        decided += 1;
        if (error.resource === 'bay') {
          excludedBays.add(pair.bay.id);
        } else {
          excludedTechnicians.add(pair.technician.id);
        }
        progress.retries += 1;
        this.telemetry.conflictRetry(error.resource);
      }
    }

    // 9. No free bay and qualified technician pair for the whole period.
    throw new SlotUnavailableError(
      `No qualified technician and service bay are both free from ` +
        `${toLocalClock(period.start, dealership.timeZone)} to ` +
        `${toLocalClock(period.end, dealership.timeZone)} (${dealership.timeZone}).`,
      await this.alternatives(dealership, serviceType, vehicle.id, period),
    );
  }

  /** Qualified technicians and bays with no CONFIRMED overlap, by name then id. */
  private async freeCandidates(
    dealership: Dealership,
    serviceType: ServiceType,
    period: Period,
  ): Promise<{ technicians: Technician[]; bays: ServiceBay[] }> {
    const [technicians, bays] = await Promise.all([
      this.scheduling.findFreeQualifiedTechnicians(
        dealership.id,
        serviceType.requiredQualificationCode,
        period,
      ),
      this.scheduling.findFreeBays(dealership.id, period),
    ]);
    return { technicians, bays };
  }

  /** Other starts that would work, as local ISO times; never shifts the request (AS7). */
  private async alternatives(
    dealership: Dealership,
    serviceType: ServiceType,
    vehicleId: string,
    period: Period,
  ): Promise<string[]> {
    const { alternativesCount, alternativesSearchDays, slotStepMinutes } = this.policy;
    const window = alternativesWindow(period.start, dealership.timeZone, alternativesSearchDays);
    const [bays, technicians, bookings, vehicleBusy] = await Promise.all([
      this.scheduling.listBays(dealership.id),
      this.scheduling.listQualifiedTechnicians(
        dealership.id,
        serviceType.requiredQualificationCode,
      ),
      this.scheduling.findConfirmedBookings(dealership.id, window),
      this.scheduling.findVehicleBusyPeriods(vehicleId, window),
    ]);
    const now = this.clock.now();

    return findAlternatives({
      requestedStart: period.start,
      weeklyHours: dealership.openingHours,
      timeZone: dealership.timeZone,
      durationMinutes: serviceType.durationMinutes,
      stepMinutes: slotStepMinutes,
      bayIds: bays.map((bay) => bay.id),
      technicianIds: technicians.map((technician) => technician.id),
      bookings,
      vehicleBusy,
      now,
      latestStart: this.latestStart(now),
      count: alternativesCount,
      searchDays: alternativesSearchDays,
    }).map(formatLocal);
  }

  private latestStart(now: Date): Date {
    return latestBookableStart(now, this.policy.horizonDays);
  }

  private async loadContext(command: BookAppointmentCommand): Promise<ResolvedContext> {
    const context = await this.scheduling.loadBookingContext(command);
    if (!context.dealership) throw new DealershipNotFoundError(command.dealershipId);
    if (!context.customer) throw new CustomerNotFoundError(command.customerId);
    if (!context.vehicle) throw new VehicleNotFoundError(command.vehicleId);
    if (!context.serviceType) throw new ServiceTypeNotFoundError(command.serviceTypeId);
    if (context.vehicle.customerId !== context.customer.id) {
      throw new VehicleNotOwnedByCustomerError(context.vehicle.id, context.customer.id);
    }
    return {
      dealership: context.dealership,
      vehicle: context.vehicle,
      serviceType: context.serviceType,
    };
  }

  private assertBookableTime(period: Period, dealership: Dealership): void {
    const now = this.clock.now();
    const start = period.start.getTime();
    if (start <= now.getTime()) {
      throw new StartInPastError();
    }
    if (start > this.latestStart(now).getTime()) {
      throw new BeyondBookingHorizonError(this.policy.horizonDays);
    }
    if (!fitsWithinOpeningHours(period, dealership.openingHours, dealership.timeZone)) {
      throw new OutsideOpeningHoursError(
        `The period ${toLocalClock(period.start, dealership.timeZone)} to ` +
          `${toLocalClock(period.end, dealership.timeZone)} (${dealership.timeZone}) is not ` +
          `within the dealership's opening hours on that day.`,
      );
    }
  }

  private async loadAppointment(appointmentId: string): Promise<Appointment> {
    const appointment = await this.appointments.findById(appointmentId);
    if (!appointment) {
      throw new InternalIntegrityError(`Appointment ${appointmentId} vanished after insert.`);
    }
    return appointment;
  }

  private decided(
    command: BookAppointmentCommand,
    startedAt: number,
    retries: number,
    result: Pick<BookingDecision, 'outcome' | 'errorCode' | 'appointmentId'>,
  ): void {
    this.telemetry.bookingDecided({
      ...result,
      retries,
      dealershipId: command.dealershipId,
      serviceTypeId: command.serviceTypeId,
      durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
    });
  }
}

const OUTCOME_BY_CODE: Readonly<Record<string, BookingOutcome>> = {
  SLOT_UNAVAILABLE: 'slot_unavailable',
  VEHICLE_ALREADY_BOOKED: 'vehicle_already_booked',
  DEALERSHIP_NOT_FOUND: 'not_found',
  CUSTOMER_NOT_FOUND: 'not_found',
  VEHICLE_NOT_FOUND: 'not_found',
  SERVICE_TYPE_NOT_FOUND: 'not_found',
  VEHICLE_NOT_OWNED_BY_CUSTOMER: 'invalid',
  START_IN_PAST: 'invalid',
  BEYOND_BOOKING_HORIZON: 'invalid',
  OUTSIDE_OPENING_HOURS: 'invalid',
  IDEMPOTENCY_KEY_REUSED: 'invalid',
};

function describeFailure(error: unknown): Pick<BookingDecision, 'outcome' | 'errorCode'> {
  if (error instanceof DomainError) {
    return { outcome: OUTCOME_BY_CODE[error.code] ?? 'error', errorCode: error.code };
  }
  return { outcome: 'error', errorCode: 'INTERNAL_ERROR' };
}

function insertOutcome(error: unknown): string {
  if (error instanceof ResourceConflictError) return `${error.resource}_conflict`;
  if (error instanceof TransientInsertError) return 'transient';
  if (error instanceof IdempotencyKeyConflictError) return 'idempotency_conflict';
  return 'error';
}
