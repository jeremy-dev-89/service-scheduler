import {
  IdempotencyKeyConflictError,
  InsertDeadlockError,
  InternalIntegrityError,
  ResourceConflictError,
} from '../../src/domain/errors';
import { mapAppointmentWriteError } from '../../src/infrastructure/repositories/pg-errors';

const pgError = (code: string, constraint?: string) =>
  Object.assign(new Error(`pg ${code}`), { code, constraint });

describe('mapAppointmentWriteError', () => {
  it.each([
    ['appointment_no_bay_overlap', 'bay'],
    ['appointment_no_technician_overlap', 'technician'],
    ['appointment_no_vehicle_overlap', 'vehicle'],
  ])('maps 23P01 on %s to a %s conflict', (constraint, resource) => {
    const mapped = mapAppointmentWriteError(pgError('23P01', constraint));

    expect(mapped).toBeInstanceOf(ResourceConflictError);
    expect(mapped).toMatchObject({ resource, constraint });
  });

  it('maps 23505 on the idempotency key index to an idempotency conflict', () => {
    expect(
      mapAppointmentWriteError(pgError('23505', 'appointment_idempotency_key_uq')),
    ).toBeInstanceOf(IdempotencyKeyConflictError);
  });

  it('maps 40P01 to a retryable deadlock error', () => {
    expect(mapAppointmentWriteError(pgError('40P01'))).toBeInstanceOf(InsertDeadlockError);
  });

  it('maps 23503 to an internal integrity error', () => {
    expect(
      mapAppointmentWriteError(pgError('23503', 'appointment_bay_same_dealership')),
    ).toBeInstanceOf(InternalIntegrityError);
  });

  it('returns unknown errors unchanged', () => {
    const unknownConstraint = pgError('23P01', 'some_other_constraint');
    const otherUnique = pgError('23505', 'appointment_pkey');
    const plain = new Error('boom');

    expect(mapAppointmentWriteError(unknownConstraint)).toBe(unknownConstraint);
    expect(mapAppointmentWriteError(otherUnique)).toBe(otherUnique);
    expect(mapAppointmentWriteError(plain)).toBe(plain);
  });
});
