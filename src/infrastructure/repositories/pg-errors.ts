import {
  type ConflictingResource,
  IdempotencyKeyConflictError,
  InsertDeadlockError,
  InternalIntegrityError,
  ResourceConflictError,
} from '../../domain/errors';

// SQLSTATE codes: https://www.postgresql.org/docs/17/errcodes-appendix.html
export const EXCLUSION_VIOLATION = '23P01';
export const UNIQUE_VIOLATION = '23505';
export const FOREIGN_KEY_VIOLATION = '23503';
export const DEADLOCK_DETECTED = '40P01';

const RESOURCE_BY_CONSTRAINT: Readonly<Record<string, ConflictingResource>> = {
  appointment_no_bay_overlap: 'bay',
  appointment_no_technician_overlap: 'technician',
  appointment_no_vehicle_overlap: 'vehicle',
};

const IDEMPOTENCY_KEY_INDEX = 'appointment_idempotency_key_uq';

export interface PgError {
  readonly code: string;
  readonly constraint?: string;
}

export function isPgError(error: unknown): error is Error & PgError {
  return error instanceof Error && typeof (error as Partial<PgError>).code === 'string';
}

/**
 * Turns a database error from an appointment write into a domain error.
 * Errors it does not recognise are returned unchanged.
 */
export function mapAppointmentWriteError(error: unknown): unknown {
  if (!isPgError(error)) {
    return error;
  }
  const constraint = error.constraint ?? '';

  switch (error.code) {
    case EXCLUSION_VIOLATION: {
      const resource = RESOURCE_BY_CONSTRAINT[constraint];
      return resource ? new ResourceConflictError(resource, constraint, { cause: error }) : error;
    }
    case UNIQUE_VIOLATION:
      return constraint === IDEMPOTENCY_KEY_INDEX
        ? new IdempotencyKeyConflictError({ cause: error })
        : error;
    case DEADLOCK_DETECTED:
      // Concurrent conflicting inserts into the GiST exclusion indexes can wait on each
      // other; PostgreSQL aborts one after deadlock_timeout. Safe to try again.
      return new InsertDeadlockError({ cause: error });
    case FOREIGN_KEY_VIOLATION:
      return new InternalIntegrityError(`Foreign key ${constraint} rejected the appointment.`, {
        cause: error,
      });
    default:
      return error;
  }
}
