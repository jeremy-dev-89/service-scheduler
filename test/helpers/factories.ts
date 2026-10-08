import { randomInt, randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import type { Database } from '../../src/infrastructure/database/database.types';

// Builds the minimum data a test needs. Tests never rely on the seed.

type Db = Kysely<Database>;

export type QualificationCode = 'GENERAL' | 'BRAKES' | 'EV_HIGH_VOLTAGE';

export interface OpeningHoursInput {
  isoDayOfWeek: number;
  opensAt: string;
  closesAt: string;
}

/** Monday to Friday, 08:00–18:00 local time. */
export const WEEKDAYS_08_TO_18: OpeningHoursInput[] = [1, 2, 3, 4, 5].map((isoDayOfWeek) => ({
  isoDayOfWeek,
  opensAt: '08:00',
  closesAt: '18:00',
}));

/** Every day of the week, 08:00–18:00 local time. */
export const EVERY_DAY_08_TO_18: OpeningHoursInput[] = [1, 2, 3, 4, 5, 6, 7].map(
  (isoDayOfWeek) => ({ isoDayOfWeek, opensAt: '08:00', closesAt: '18:00' }),
);

const VIN_ALPHABET = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';

export function randomVin(): string {
  return Array.from({ length: 17 }, () => VIN_ALPHABET[randomInt(VIN_ALPHABET.length)]).join('');
}

const shortId = (): string => randomUUID().slice(0, 8);

export async function ensureQualifications(db: Db): Promise<void> {
  await db
    .insertInto('qualification')
    .values([
      { code: 'GENERAL', name: 'General servicing' },
      { code: 'BRAKES', name: 'Brakes' },
      { code: 'EV_HIGH_VOLTAGE', name: 'EV high voltage' },
    ])
    .onConflict((oc) => oc.doNothing())
    .execute();
}

export interface DealershipFixture {
  id: string;
  name: string;
  timeZone: string;
}

export async function createDealership(
  db: Db,
  options: { name?: string; timeZone?: string; openingHours?: OpeningHoursInput[] } = {},
): Promise<DealershipFixture> {
  const name = options.name ?? `Dealership ${shortId()}`;
  const timeZone = options.timeZone ?? 'Europe/London';
  const { id } = await db
    .insertInto('dealership')
    .values({ name, time_zone: timeZone })
    .returning('id')
    .executeTakeFirstOrThrow();

  const hours = options.openingHours ?? WEEKDAYS_08_TO_18;
  if (hours.length > 0) {
    await db
      .insertInto('dealership_opening_hours')
      .values(
        hours.map((h) => ({
          dealership_id: id,
          iso_day_of_week: h.isoDayOfWeek,
          opens_at: h.opensAt,
          closes_at: h.closesAt,
        })),
      )
      .execute();
  }
  return { id, name, timeZone };
}

export interface NamedFixture {
  id: string;
  name: string;
}

export async function createBay(
  db: Db,
  dealershipId: string,
  name?: string,
): Promise<NamedFixture> {
  const bayName = name ?? `Bay ${shortId()}`;
  const { id } = await db
    .insertInto('service_bay')
    .values({ dealership_id: dealershipId, name: bayName })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id, name: bayName };
}

export async function createBays(
  db: Db,
  dealershipId: string,
  count: number,
): Promise<NamedFixture[]> {
  const bays: NamedFixture[] = [];
  for (let i = 1; i <= count; i += 1) {
    bays.push(await createBay(db, dealershipId, `Bay ${String(i).padStart(2, '0')}`));
  }
  return bays;
}

export async function createTechnician(
  db: Db,
  dealershipId: string,
  options: { name?: string; qualifications?: QualificationCode[] } = {},
): Promise<NamedFixture> {
  await ensureQualifications(db);
  const name = options.name ?? `Technician ${shortId()}`;
  const { id } = await db
    .insertInto('technician')
    .values({ dealership_id: dealershipId, name })
    .returning('id')
    .executeTakeFirstOrThrow();

  const qualifications = options.qualifications ?? ['GENERAL'];
  if (qualifications.length > 0) {
    await db
      .insertInto('technician_qualification')
      .values(qualifications.map((code) => ({ technician_id: id, qualification_code: code })))
      .execute();
  }
  return { id, name };
}

export async function createTechnicians(
  db: Db,
  dealershipId: string,
  count: number,
  qualifications: QualificationCode[] = ['GENERAL'],
): Promise<NamedFixture[]> {
  const technicians: NamedFixture[] = [];
  for (let i = 1; i <= count; i += 1) {
    technicians.push(
      await createTechnician(db, dealershipId, {
        name: `Technician ${String(i).padStart(2, '0')}`,
        qualifications,
      }),
    );
  }
  return technicians;
}

export interface ServiceTypeFixture {
  id: string;
  code: string;
  name: string;
  durationMinutes: number;
  qualification: QualificationCode;
}

export async function createServiceType(
  db: Db,
  options: {
    code?: string;
    name?: string;
    durationMinutes?: number;
    qualification?: QualificationCode;
  } = {},
): Promise<ServiceTypeFixture> {
  await ensureQualifications(db);
  const code = options.code ?? `SERVICE_${shortId().toUpperCase()}`;
  const name = options.name ?? `Service ${code}`;
  const durationMinutes = options.durationMinutes ?? 60;
  const qualification = options.qualification ?? 'GENERAL';
  const { id } = await db
    .insertInto('service_type')
    .values({
      code,
      name,
      duration_minutes: durationMinutes,
      required_qualification_code: qualification,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id, code, name, durationMinutes, qualification };
}

export interface CustomerFixture {
  customerId: string;
  vehicleId: string;
  fullName: string;
  vin: string;
}

export async function createCustomerWithVehicle(
  db: Db,
  options: { fullName?: string; vin?: string } = {},
): Promise<CustomerFixture> {
  const fullName = options.fullName ?? `Customer ${shortId()}`;
  const vin = options.vin ?? randomVin();
  const customer = await db
    .insertInto('customer')
    .values({ full_name: fullName, email: `${shortId()}@example.com` })
    .returning('id')
    .executeTakeFirstOrThrow();
  const vehicle = await db
    .insertInto('vehicle')
    .values({
      customer_id: customer.id,
      vin,
      make: 'Testmake',
      model: 'Testmodel',
      model_year: 2022,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { customerId: customer.id, vehicleId: vehicle.id, fullName, vin };
}

/** Distinct customers, each with their own vehicle, for the concurrency tests. */
export async function createCustomersWithVehicles(
  db: Db,
  count: number,
): Promise<CustomerFixture[]> {
  const customers: CustomerFixture[] = [];
  for (let i = 0; i < count; i += 1) {
    customers.push(await createCustomerWithVehicle(db));
  }
  return customers;
}

export interface AppointmentInsert {
  dealershipId: string;
  customerId: string;
  vehicleId: string;
  serviceTypeId: string;
  serviceBayId: string;
  technicianId: string;
  startsAt: Date;
  endsAt: Date;
  status?: 'CONFIRMED' | 'CANCELLED';
}

/** Inserts an appointment row directly, bypassing the API. */
export async function insertAppointment(db: Db, input: AppointmentInsert): Promise<string> {
  const status = input.status ?? 'CONFIRMED';
  const { id } = await db
    .insertInto('appointment')
    .values({
      dealership_id: input.dealershipId,
      customer_id: input.customerId,
      vehicle_id: input.vehicleId,
      service_type_id: input.serviceTypeId,
      service_bay_id: input.serviceBayId,
      technician_id: input.technicianId,
      period: sql<string>`tstzrange(${input.startsAt}::timestamptz, ${input.endsAt}::timestamptz, '[)')`,
      status,
      cancelled_at: status === 'CANCELLED' ? input.startsAt : null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}
