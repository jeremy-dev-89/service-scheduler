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
