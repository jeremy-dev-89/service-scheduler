import type { Period } from '../domain/period';
import type {
  Appointment,
  Customer,
  Dealership,
  ResourceBooking,
  ServiceBay,
  ServiceType,
  Technician,
  Vehicle,
} from '../domain/types';

// Ports: what the application needs from the outside world. Infrastructure implements
// them; tests can replace them. DI tokens sit next to each interface.

/** The only source of "now" for business rules. Tests inject a fixed clock. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('Clock');

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Answers whether the service can reach its dependencies. */
export interface ReadinessCheck {
  isReady(): Promise<boolean>;
}

export const READINESS_CHECK = Symbol('ReadinessCheck');

/** Everything a booking request refers to; undefined where the record does not exist. */
export interface BookingContext {
  readonly dealership: Dealership | undefined;
  readonly customer: Customer | undefined;
  readonly vehicle: Vehicle | undefined;
  readonly serviceType: ServiceType | undefined;
}

/** Read-only queries for scheduling decisions. No locks are taken. */
export interface SchedulingRepository {
  loadBookingContext(ids: {
    dealershipId: string;
    customerId: string;
    vehicleId: string;
    serviceTypeId: string;
  }): Promise<BookingContext>;

  findDealership(dealershipId: string): Promise<Dealership | undefined>;

  findServiceType(serviceTypeId: string): Promise<ServiceType | undefined>;

  /** Technicians of the dealership with the qualification and no CONFIRMED overlap; by name, then id. */
  findFreeQualifiedTechnicians(
    dealershipId: string,
    qualificationCode: string,
    period: Period,
  ): Promise<Technician[]>;

  /** Bays of the dealership with no CONFIRMED overlap; by name, then id. */
  findFreeBays(dealershipId: string, period: Period): Promise<ServiceBay[]>;

  /** True when the vehicle has a CONFIRMED appointment overlapping the period. */
  vehicleHasOverlap(vehicleId: string, period: Period): Promise<boolean>;

  /** CONFIRMED appointments of the dealership overlapping the window. */
  findConfirmedBookings(dealershipId: string, window: Period): Promise<ResourceBooking[]>;

  /** Periods of CONFIRMED appointments of the vehicle overlapping the window. */
  findVehicleBusyPeriods(vehicleId: string, window: Period): Promise<Period[]>;

  /** Every bay of the dealership; by name, then id. */
  listBays(dealershipId: string): Promise<ServiceBay[]>;

  /** Every technician of the dealership with the qualification; by name, then id. */
  listQualifiedTechnicians(dealershipId: string, qualificationCode: string): Promise<Technician[]>;
}

export const SCHEDULING_REPOSITORY = Symbol('SchedulingRepository');

export interface NewAppointment {
  readonly dealershipId: string;
  readonly customerId: string;
  readonly vehicleId: string;
  readonly serviceTypeId: string;
  readonly serviceBayId: string;
  readonly technicianId: string;
  readonly period: Period;
  readonly idempotencyKey?: string;
  readonly idempotencyFingerprint?: string;
}

export interface IdempotencyRecord {
  readonly appointmentId: string;
  readonly fingerprint: string | null;
}

export interface AppointmentRepository {
  /**
   * Inserts a CONFIRMED appointment in a single autocommit statement and returns its id.
   * The database decides: throws ResourceConflictError when an exclusion constraint
   * rejects the row, IdempotencyKeyConflictError when the key is already stored, and
   * InternalIntegrityError on a foreign key violation.
   */
  insertConfirmed(appointment: NewAppointment): Promise<string>;

  findById(appointmentId: string): Promise<Appointment | undefined>;

  findByIdempotencyKey(idempotencyKey: string): Promise<IdempotencyRecord | undefined>;

  /** Marks a CONFIRMED appointment CANCELLED; a CANCELLED one is left unchanged. */
  cancel(appointmentId: string, cancelledAt: Date): Promise<void>;
}

export const APPOINTMENT_REPOSITORY = Symbol('AppointmentRepository');

/** Booking rules that come from configuration. */
export interface BookingPolicy {
  /** Latest bookable start, in days after now (AS11). */
  readonly horizonDays: number;
  /** Insert attempts before answering 409 SLOT_UNAVAILABLE. */
  readonly maxAttempts: number;
  /** Step between suggested starts, in minutes (AS16). */
  readonly slotStepMinutes: number;
  /** Alternatives offered in a 409 response. */
  readonly alternativesCount: number;
  /** Days after the requested day scanned for alternatives. */
  readonly alternativesSearchDays: number;
}

export const BOOKING_POLICY = Symbol('BookingPolicy');

export type BookingOutcome =
  'confirmed' | 'slot_unavailable' | 'vehicle_already_booked' | 'invalid' | 'not_found' | 'error';

/** One booking decision, recorded once per POST /appointments. IDs only, no personal data. */
export interface BookingDecision {
  readonly outcome: BookingOutcome;
  readonly errorCode?: string;
  readonly retries: number;
  readonly dealershipId: string;
  readonly serviceTypeId: string;
  readonly appointmentId?: string;
  readonly durationMs: number;
}

export type SpanAttributes = Record<string, string | number | boolean>;

/** Metrics, the decision log line and trace spans for bookings. */
export interface BookingTelemetry {
  /** Runs `work` inside a trace span; `setAttributes` adds attributes once they are known. */
  span<T>(
    name: string,
    attributes: SpanAttributes,
    work: (setAttributes: (attributes: SpanAttributes) => void) => Promise<T>,
  ): Promise<T>;
  /** An insert lost a race on this resource and the next pair will be tried. */
  conflictRetry(resource: 'bay' | 'technician'): void;
  bookingDecided(decision: BookingDecision): void;
}

export const BOOKING_TELEMETRY = Symbol('BookingTelemetry');
