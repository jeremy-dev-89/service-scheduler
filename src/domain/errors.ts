// One DomainError subclass per error code in the API specification. The API layer maps
// each code to an HTTP status; the domain knows nothing about HTTP. Messages carry IDs
// only, never names, contact details or VINs.

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'DEALERSHIP_NOT_FOUND'
  | 'CUSTOMER_NOT_FOUND'
  | 'VEHICLE_NOT_FOUND'
  | 'SERVICE_TYPE_NOT_FOUND'
  | 'APPOINTMENT_NOT_FOUND'
  | 'VEHICLE_NOT_OWNED_BY_CUSTOMER'
  | 'START_IN_PAST'
  | 'BEYOND_BOOKING_HORIZON'
  | 'OUTSIDE_OPENING_HOURS'
  | 'SLOT_UNAVAILABLE'
  | 'VEHICLE_ALREADY_BOOKED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'INTERNAL_ERROR';

export abstract class DomainError extends Error {
  abstract readonly code: ErrorCode;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export interface ValidationIssue {
  readonly field: string;
  readonly message: string;
}

export class ValidationFailedError extends DomainError {
  readonly code = 'VALIDATION_FAILED';

  constructor(readonly errors: readonly ValidationIssue[]) {
    super('The request is not valid.');
  }
}

export class DealershipNotFoundError extends DomainError {
  readonly code = 'DEALERSHIP_NOT_FOUND';

  constructor(readonly dealershipId: string) {
    super(`Dealership ${dealershipId} does not exist.`);
  }
}

export class CustomerNotFoundError extends DomainError {
  readonly code = 'CUSTOMER_NOT_FOUND';

  constructor(readonly customerId: string) {
    super(`Customer ${customerId} does not exist.`);
  }
}

export class VehicleNotFoundError extends DomainError {
  readonly code = 'VEHICLE_NOT_FOUND';

  constructor(readonly vehicleId: string) {
    super(`Vehicle ${vehicleId} does not exist.`);
  }
}

export class ServiceTypeNotFoundError extends DomainError {
  readonly code = 'SERVICE_TYPE_NOT_FOUND';

  constructor(readonly serviceTypeId: string) {
    super(`Service type ${serviceTypeId} does not exist.`);
  }
}

export class AppointmentNotFoundError extends DomainError {
  readonly code = 'APPOINTMENT_NOT_FOUND';

  constructor(readonly appointmentId: string) {
    super(`Appointment ${appointmentId} does not exist.`);
  }
}

export class VehicleNotOwnedByCustomerError extends DomainError {
  readonly code = 'VEHICLE_NOT_OWNED_BY_CUSTOMER';

  constructor(
    readonly vehicleId: string,
    readonly customerId: string,
  ) {
    super(`Vehicle ${vehicleId} does not belong to customer ${customerId}.`);
  }
}

export class StartInPastError extends DomainError {
  readonly code = 'START_IN_PAST';

  constructor() {
    super('The requested start time is not in the future.');
  }
}

export class BeyondBookingHorizonError extends DomainError {
  readonly code = 'BEYOND_BOOKING_HORIZON';

  constructor(readonly horizonDays: number) {
    super(`Appointments can be booked at most ${horizonDays} days ahead.`);
  }
}

export class OutsideOpeningHoursError extends DomainError {
  readonly code = 'OUTSIDE_OPENING_HOURS';

  constructor(detail: string) {
    super(detail);
  }
}

export class SlotUnavailableError extends DomainError {
  readonly code = 'SLOT_UNAVAILABLE';

  /** @param alternatives other start times, ISO 8601 with the dealership's offset */
  constructor(
    detail: string,
    readonly alternatives: readonly string[] = [],
  ) {
    super(detail);
  }
}

export class VehicleAlreadyBookedError extends DomainError {
  readonly code = 'VEHICLE_ALREADY_BOOKED';

  constructor(readonly vehicleId: string) {
    super(`Vehicle ${vehicleId} already has an appointment that overlaps this period.`);
  }
}

export class IdempotencyKeyReusedError extends DomainError {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';

  constructor() {
    super('This Idempotency-Key was already used with a different request body.');
  }
}

/** A database integrity failure the use case did not expect (for example a foreign key). */
export class InternalIntegrityError extends DomainError {
  readonly code = 'INTERNAL_ERROR';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

// Conflict signals raised by persistence and handled inside the booking use case.
// They never reach a client directly.

export type ConflictingResource = 'bay' | 'technician' | 'vehicle';

/** The insert lost a race: another confirmed appointment holds this resource. */
export class ResourceConflictError extends Error {
  constructor(
    readonly resource: ConflictingResource,
    readonly constraint: string,
    options?: ErrorOptions,
  ) {
    super(
      `Exclusion constraint ${constraint} rejected the appointment (${resource} taken).`,
      options,
    );
    this.name = 'ResourceConflictError';
  }
}

/** Another request inserted an appointment with the same idempotency key first. */
export class IdempotencyKeyConflictError extends Error {
  constructor(options?: ErrorOptions) {
    super('Another request stored this idempotency key first.', options);
    this.name = 'IdempotencyKeyConflictError';
  }
}

/**
 * PostgreSQL chose this insert as a deadlock victim. Two concurrent inserts that conflict
 * on an exclusion constraint can each wait for the other; one is aborted and wrote
 * nothing, so the same insert can simply be tried again.
 */
export class InsertDeadlockError extends Error {
  constructor(options?: ErrorOptions) {
    super('The insert was aborted to resolve a deadlock; nothing was written.', options);
    this.name = 'InsertDeadlockError';
  }
}
