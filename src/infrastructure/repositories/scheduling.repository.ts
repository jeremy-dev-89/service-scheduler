import { Inject, Injectable } from '@nestjs/common';
import { type Expression, type Kysely, type SqlBool, sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { BookingContext, SchedulingRepository } from '../../application/ports';
import { Period } from '../../domain/period';
import type {
  Dealership,
  ResourceBooking,
  ServiceBay,
  ServiceType,
  Technician,
} from '../../domain/types';
import { KYSELY } from '../database/database.module';
import type { Database } from '../database/database.types';

/** `<range column> && [start, end)`: true when the stored period overlaps the given one. */
export function overlaps(rangeColumn: string, period: Period): Expression<SqlBool> {
  return sql<SqlBool>`${sql.ref(rangeColumn)} && tstzrange(${period.start}::timestamptz, ${period.end}::timestamptz, '[)')`;
}

const toPeriod = (row: { starts_at: Date; ends_at: Date }): Period =>
  Period.between(row.starts_at, row.ends_at);

/** Read-only scheduling queries. No row locks: the INSERT and its constraints decide. */
@Injectable()
export class KyselySchedulingRepository implements SchedulingRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  async loadBookingContext(ids: {
    dealershipId: string;
    customerId: string;
    vehicleId: string;
    serviceTypeId: string;
  }): Promise<BookingContext> {
    const [dealership, customer, vehicle, serviceType] = await Promise.all([
      this.findDealership(ids.dealershipId),
      this.db
        .selectFrom('customer')
        .select(['id', 'full_name'])
        .where('id', '=', ids.customerId)
        .executeTakeFirst(),
      this.db
        .selectFrom('vehicle')
        .select(['id', 'customer_id', 'vin', 'make', 'model'])
        .where('id', '=', ids.vehicleId)
        .executeTakeFirst(),
      this.findServiceType(ids.serviceTypeId),
    ]);

    return {
      dealership,
      customer: customer && { id: customer.id, fullName: customer.full_name },
      vehicle: vehicle && {
        id: vehicle.id,
        customerId: vehicle.customer_id,
        vin: vehicle.vin,
        make: vehicle.make,
        model: vehicle.model,
      },
      serviceType,
    };
  }

  async findDealership(dealershipId: string): Promise<Dealership | undefined> {
    const row = await this.db
      .selectFrom('dealership as d')
      .select((eb) => [
        'd.id',
        'd.name',
        'd.time_zone',
        jsonArrayFrom(
          eb
            .selectFrom('dealership_opening_hours as h')
            .select(['h.iso_day_of_week', 'h.opens_at', 'h.closes_at'])
            .whereRef('h.dealership_id', '=', 'd.id')
            .orderBy('h.iso_day_of_week'),
        ).as('opening_hours'),
      ])
      .where('d.id', '=', dealershipId)
      .executeTakeFirst();

    return (
      row && {
        id: row.id,
        name: row.name,
        timeZone: row.time_zone,
        openingHours: row.opening_hours.map((h) => ({
          isoDayOfWeek: h.iso_day_of_week,
          opensAt: h.opens_at,
          closesAt: h.closes_at,
        })),
      }
    );
  }

  async findServiceType(serviceTypeId: string): Promise<ServiceType | undefined> {
    const row = await this.db
      .selectFrom('service_type')
      .select(['id', 'code', 'name', 'duration_minutes', 'required_qualification_code'])
      .where('id', '=', serviceTypeId)
      .executeTakeFirst();

    return (
      row && {
        id: row.id,
        code: row.code,
        name: row.name,
        durationMinutes: row.duration_minutes,
        requiredQualificationCode: row.required_qualification_code,
      }
    );
  }

  async findFreeQualifiedTechnicians(
    dealershipId: string,
    qualificationCode: string,
    period: Period,
  ): Promise<Technician[]> {
    return this.db
      .selectFrom('technician as t')
      .innerJoin('technician_qualification as tq', 'tq.technician_id', 't.id')
      .select(['t.id', 't.name'])
      .where('t.dealership_id', '=', dealershipId)
      .where('tq.qualification_code', '=', qualificationCode)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('appointment as a')
              .select('a.id')
              .whereRef('a.technician_id', '=', 't.id')
              .where('a.status', '=', 'CONFIRMED')
              .where(overlaps('a.period', period)),
          ),
        ),
      )
      .orderBy('t.name')
      .orderBy('t.id')
      .execute();
  }

  async findFreeBays(dealershipId: string, period: Period): Promise<ServiceBay[]> {
    return this.db
      .selectFrom('service_bay as b')
      .select(['b.id', 'b.name'])
      .where('b.dealership_id', '=', dealershipId)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('appointment as a')
              .select('a.id')
              .whereRef('a.service_bay_id', '=', 'b.id')
              .where('a.status', '=', 'CONFIRMED')
              .where(overlaps('a.period', period)),
          ),
        ),
      )
      .orderBy('b.name')
      .orderBy('b.id')
      .execute();
  }

  async vehicleHasOverlap(vehicleId: string, period: Period): Promise<boolean> {
    const row = await this.db
      .selectFrom('appointment as a')
      .select('a.id')
      .where('a.vehicle_id', '=', vehicleId)
      .where('a.status', '=', 'CONFIRMED')
      .where(overlaps('a.period', period))
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  async findConfirmedBookings(dealershipId: string, window: Period): Promise<ResourceBooking[]> {
    const rows = await this.db
      .selectFrom('appointment as a')
      .select([
        'a.service_bay_id',
        'a.technician_id',
        sql<Date>`lower(a.period)`.as('starts_at'),
        sql<Date>`upper(a.period)`.as('ends_at'),
      ])
      .where('a.dealership_id', '=', dealershipId)
      .where('a.status', '=', 'CONFIRMED')
      .where(overlaps('a.period', window))
      .execute();

    return rows.map((row) => ({
      serviceBayId: row.service_bay_id,
      technicianId: row.technician_id,
      period: toPeriod(row),
    }));
  }

  async findVehicleBusyPeriods(vehicleId: string, window: Period): Promise<Period[]> {
    const rows = await this.db
      .selectFrom('appointment as a')
      .select([
        sql<Date>`lower(a.period)`.as('starts_at'),
        sql<Date>`upper(a.period)`.as('ends_at'),
      ])
      .where('a.vehicle_id', '=', vehicleId)
      .where('a.status', '=', 'CONFIRMED')
      .where(overlaps('a.period', window))
      .execute();

    return rows.map(toPeriod);
  }

  async listBays(dealershipId: string): Promise<ServiceBay[]> {
    return this.db
      .selectFrom('service_bay')
      .select(['id', 'name'])
      .where('dealership_id', '=', dealershipId)
      .orderBy('name')
      .orderBy('id')
      .execute();
  }

  async listQualifiedTechnicians(
    dealershipId: string,
    qualificationCode: string,
  ): Promise<Technician[]> {
    return this.db
      .selectFrom('technician as t')
      .innerJoin('technician_qualification as tq', 'tq.technician_id', 't.id')
      .select(['t.id', 't.name'])
      .where('t.dealership_id', '=', dealershipId)
      .where('tq.qualification_code', '=', qualificationCode)
      .orderBy('t.name')
      .orderBy('t.id')
      .execute();
  }
}
