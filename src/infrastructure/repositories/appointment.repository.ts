import { Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import type {
  AppointmentRepository,
  IdempotencyRecord,
  NewAppointment,
} from '../../application/ports';
import {
  IdempotencyKeyConflictError,
  ResourceConflictError,
  TransientInsertError,
} from '../../domain/errors';
import { Period } from '../../domain/period';
import type { Appointment } from '../../domain/types';
import { KYSELY } from '../database/database.module';
import type { Database } from '../database/database.types';
import { mapAppointmentWriteError } from './pg-errors';
import { overlaps } from './scheduling.repository';

@Injectable()
export class KyselyAppointmentRepository implements AppointmentRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  /**
   * One autocommit INSERT … ON CONFLICT DO NOTHING: no transaction, no locks. The exclusion
   * constraints and the idempotency index are the arbiters, so the database decides.
   * Speculative insertion makes racing inserts deadlock-free (ADR-001). When the insert
   * loses it writes nothing, and a follow-up read says which resource was taken.
   */
  async insertConfirmed(appointment: NewAppointment): Promise<string> {
    const { start, end } = appointment.period;
    let row: { id: string } | undefined;
    try {
      row = await this.db
        .insertInto('appointment')
        .values({
          dealership_id: appointment.dealershipId,
          customer_id: appointment.customerId,
          vehicle_id: appointment.vehicleId,
          service_type_id: appointment.serviceTypeId,
          service_bay_id: appointment.serviceBayId,
          technician_id: appointment.technicianId,
          period: sql<string>`tstzrange(${start}::timestamptz, ${end}::timestamptz, '[)')`,
          status: 'CONFIRMED',
          idempotency_key: appointment.idempotencyKey ?? null,
          idempotency_fingerprint: appointment.idempotencyFingerprint ?? null,
        })
        .onConflict((oc) => oc.doNothing())
        .returning('id')
        .executeTakeFirst();
    } catch (error) {
      throw mapAppointmentWriteError(error);
    }
    if (row) {
      return row.id;
    }
    throw await this.lostRace(appointment);
  }

  /**
   * The insert did nothing: a committed row holds the idempotency key or overlaps on the
   * vehicle, bay or technician. Reports the most decisive one. If none is found, the
   * winning row was cancelled in the meantime and the insert can simply be tried again.
   */
  private async lostRace(appointment: NewAppointment): Promise<Error> {
    const confirmedOverlap = (
      column: 'vehicle_id' | 'service_bay_id' | 'technician_id',
      id: string,
    ) =>
      this.db
        .selectFrom('appointment as a')
        .select(sql<number>`1`.as('one'))
        .where(`a.${column}`, '=', id)
        .where('a.status', '=', 'CONFIRMED')
        .where(overlaps('a.period', appointment.period));

    const taken = await this.db
      .selectNoFrom((eb) => [
        appointment.idempotencyKey === undefined
          ? sql<boolean>`false`.as('key')
          : eb
              .exists(
                eb
                  .selectFrom('appointment')
                  .select(sql<number>`1`.as('one'))
                  .where('idempotency_key', '=', appointment.idempotencyKey),
              )
              .as('key'),
        eb.exists(confirmedOverlap('vehicle_id', appointment.vehicleId)).as('vehicle'),
        eb.exists(confirmedOverlap('service_bay_id', appointment.serviceBayId)).as('bay'),
        eb.exists(confirmedOverlap('technician_id', appointment.technicianId)).as('technician'),
      ])
      .executeTakeFirstOrThrow();

    if (taken.key) return new IdempotencyKeyConflictError();
    if (taken.vehicle)
      return new ResourceConflictError('vehicle', 'appointment_no_vehicle_overlap');
    if (taken.bay) return new ResourceConflictError('bay', 'appointment_no_bay_overlap');
    if (taken.technician) {
      return new ResourceConflictError('technician', 'appointment_no_technician_overlap');
    }
    return new TransientInsertError();
  }

  async findById(appointmentId: string): Promise<Appointment | undefined> {
    // Only the customer's name is read: contact details stay out of responses.
    const row = await this.db
      .selectFrom('appointment as a')
      .innerJoin('dealership as d', 'd.id', 'a.dealership_id')
      .innerJoin('customer as c', 'c.id', 'a.customer_id')
      .innerJoin('vehicle as v', 'v.id', 'a.vehicle_id')
      .innerJoin('service_type as st', 'st.id', 'a.service_type_id')
      .innerJoin('service_bay as b', 'b.id', 'a.service_bay_id')
      .innerJoin('technician as t', 't.id', 'a.technician_id')
      .select([
        'a.id',
        'a.status',
        'a.created_at',
        sql<Date>`lower(a.period)`.as('starts_at'),
        sql<Date>`upper(a.period)`.as('ends_at'),
        'd.id as dealership_id',
        'd.name as dealership_name',
        'd.time_zone',
        'c.id as customer_id',
        'c.full_name',
        'v.id as vehicle_id',
        'v.vin',
        'v.make',
        'v.model',
        'st.id as service_type_id',
        'st.code as service_type_code',
        'st.name as service_type_name',
        'st.duration_minutes',
        'b.id as bay_id',
        'b.name as bay_name',
        't.id as technician_id',
        't.name as technician_name',
      ])
      .where('a.id', '=', appointmentId)
      .executeTakeFirst();

    if (!row) {
      return undefined;
    }
    return {
      id: row.id,
      status: row.status,
      period: Period.between(row.starts_at, row.ends_at),
      dealership: { id: row.dealership_id, name: row.dealership_name, timeZone: row.time_zone },
      customer: { id: row.customer_id, fullName: row.full_name },
      vehicle: { id: row.vehicle_id, vin: row.vin, make: row.make, model: row.model },
      serviceType: {
        id: row.service_type_id,
        code: row.service_type_code,
        name: row.service_type_name,
        durationMinutes: row.duration_minutes,
      },
      serviceBay: { id: row.bay_id, name: row.bay_name },
      technician: { id: row.technician_id, name: row.technician_name },
      createdAt: row.created_at,
    };
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<IdempotencyRecord | undefined> {
    const row = await this.db
      .selectFrom('appointment')
      .select(['id', 'idempotency_fingerprint'])
      .where('idempotency_key', '=', idempotencyKey)
      .executeTakeFirst();
    return row && { appointmentId: row.id, fingerprint: row.idempotency_fingerprint };
  }

  async cancel(appointmentId: string, cancelledAt: Date): Promise<void> {
    await this.db
      .updateTable('appointment')
      .set({ status: 'CANCELLED', cancelled_at: cancelledAt })
      .where('id', '=', appointmentId)
      .where('status', '=', 'CONFIRMED')
      .execute();
  }
}
