import { Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import type {
  AppointmentRepository,
  IdempotencyRecord,
  NewAppointment,
} from '../../application/ports';
import { Period } from '../../domain/period';
import type { Appointment } from '../../domain/types';
import { KYSELY } from '../database/database.module';
import type { Database } from '../database/database.types';
import { mapAppointmentWriteError } from './pg-errors';

@Injectable()
export class KyselyAppointmentRepository implements AppointmentRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  /** One autocommit INSERT: no transaction, no locks. The exclusion constraints decide. */
  async insertConfirmed(appointment: NewAppointment): Promise<string> {
    const { start, end } = appointment.period;
    try {
      const row = await this.db
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
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    } catch (error) {
      throw mapAppointmentWriteError(error);
    }
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
