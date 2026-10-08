import { Inject, Injectable } from '@nestjs/common';
import { nextCandidatePair } from '../domain/allocation';
import {
  BeyondBookingHorizonError,
  CustomerNotFoundError,
  DealershipNotFoundError,
  DomainError,
  IdempotencyKeyConflictError,
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
import { fitsWithinOpeningHours, toLocalClock } from '../domain/opening-hours';
import { Period } from '../domain/period';
import type { Appointment, Dealership, ServiceType, Vehicle } from '../domain/types';
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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface BookAppointmentCommand {
  readonly dealershipId: string;
  readonly customerId: string;
  readonly vehicleId: string;
  readonly serviceTypeId: string;
  readonly startsAt: Date;
}

export interface BookingResult {
  readonly appointment: Appointment;
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
    const [technicians, bays] = await Promise.all([
      this.scheduling.findFreeQualifiedTechnicians(
        dealership.id,
        serviceType.requiredQualificationCode,
        period,
      ),
      this.scheduling.findFreeBays(dealership.id, period),
    ]);

    // 8. Try pairs until an insert succeeds; each lost race excludes one resource.
    const excludedTechnicians = new Set<string>();
    const excludedBays = new Set<string>();
    for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt += 1) {
      const pair = nextCandidatePair(technicians, bays, excludedTechnicians, excludedBays);
      if (!pair) {
        break;
      }
      try {
        const appointmentId = await this.telemetry.span(
          'booking.insert_attempt',
          { attempt },
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
              });
              setAttributes({ outcome: 'inserted' });
              return id;
            } catch (error) {
              setAttributes({ outcome: insertOutcome(error) });
              throw error;
            }
          },
        );
        return { appointment: await this.loadAppointment(appointmentId) };
      } catch (error) {
        if (!(error instanceof ResourceConflictError)) {
          throw error;
        }
        if (error.resource === 'vehicle') {
          throw new VehicleAlreadyBookedError(vehicle.id);
        }
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
    );
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
    const now = this.clock.now().getTime();
    const start = period.start.getTime();
    if (start <= now) {
      throw new StartInPastError();
    }
    if (start > now + this.policy.horizonDays * MS_PER_DAY) {
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
  if (error instanceof IdempotencyKeyConflictError) return 'idempotency_conflict';
  return 'error';
}
