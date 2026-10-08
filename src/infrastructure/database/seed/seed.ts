import type { Kysely } from 'kysely';
import { validateConfig } from '../../../config/config.schema';
import { createKysely } from '../database.module';
import type { Database } from '../database.types';
import { SEED_IDS as ids } from './ids';

// Fictional reference data. Idempotent: every insert is ON CONFLICT DO NOTHING.
// The seed never creates appointments.

const weekdays = [1, 2, 3, 4, 5];

export async function seed(db: Kysely<Database>): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('dealership')
      .values([
        {
          id: ids.dealerships.northsideMotors,
          name: 'Northside Motors',
          time_zone: 'Europe/London',
        },
        {
          id: ids.dealerships.saigonAutoService,
          name: 'Saigon Auto Service',
          time_zone: 'Asia/Ho_Chi_Minh',
        },
      ])
      .onConflict((oc) => oc.doNothing())
      .execute();

    await trx
      .insertInto('dealership_opening_hours')
      .values([
        ...weekdays.map((day) => ({
          dealership_id: ids.dealerships.northsideMotors,
          iso_day_of_week: day,
          opens_at: '08:00',
          closes_at: '18:00',
        })),
        {
          dealership_id: ids.dealerships.northsideMotors,
          iso_day_of_week: 6,
          opens_at: '09:00',
          closes_at: '13:00',
        },
        ...[...weekdays, 6].map((day) => ({
          dealership_id: ids.dealerships.saigonAutoService,
          iso_day_of_week: day,
          opens_at: '07:30',
          closes_at: '17:30',
        })),
      ])
      .onConflict((oc) => oc.doNothing())
      .execute();

    await trx
      .insertInto('qualification')
      .values([
        { code: 'GENERAL', name: 'General servicing' },
        { code: 'BRAKES', name: 'Brakes' },
        { code: 'EV_HIGH_VOLTAGE', name: 'EV high voltage' },
      ])
      .onConflict((oc) => oc.doNothing())
      .execute();

    await trx
      .insertInto('service_type')
      .values([
        {
          id: ids.serviceTypes.oilService,
          code: 'OIL_SERVICE',
          name: 'Oil service',
          duration_minutes: 60,
          required_qualification_code: 'GENERAL',
        },
        {
          id: ids.serviceTypes.brakeReplacement,
          code: 'BRAKE_REPLACEMENT',
          name: 'Brake replacement',
          duration_minutes: 120,
          required_qualification_code: 'BRAKES',
        },
        {
          id: ids.serviceTypes.evBatteryCheck,
          code: 'EV_BATTERY_CHECK',
          name: 'EV battery check',
          duration_minutes: 90,
          required_qualification_code: 'EV_HIGH_VOLTAGE',
        },
        {
          id: ids.serviceTypes.annualService,
          code: 'ANNUAL_SERVICE',
          name: 'Annual service',
          duration_minutes: 180,
          required_qualification_code: 'GENERAL',
        },
      ])
      .onConflict((oc) => oc.doNothing())
      .execute();

    await trx
      .insertInto('service_bay')
      .values([
        {
          id: ids.serviceBays.northsideBay1,
          dealership_id: ids.dealerships.northsideMotors,
          name: 'Bay 1',
        },
        {
          id: ids.serviceBays.northsideBay2,
          dealership_id: ids.dealerships.northsideMotors,
          name: 'Bay 2',
        },
        {
          id: ids.serviceBays.northsideBay3,
          dealership_id: ids.dealerships.northsideMotors,
          name: 'Bay 3',
        },
        {
          id: ids.serviceBays.saigonBayA,
          dealership_id: ids.dealerships.saigonAutoService,
          name: 'Bay A',
        },
        {
          id: ids.serviceBays.saigonBayB,
          dealership_id: ids.dealerships.saigonAutoService,
          name: 'Bay B',
        },
      ])
      .onConflict((oc) => oc.doNothing())
      .execute();

    const technicians = [
      {
        id: ids.technicians.alexMorgan,
        dealership_id: ids.dealerships.northsideMotors,
        name: 'Alex Morgan',
        qualifications: ['GENERAL', 'BRAKES'],
      },
      {
        id: ids.technicians.priyaShah,
        dealership_id: ids.dealerships.northsideMotors,
        name: 'Priya Shah',
        qualifications: ['GENERAL', 'EV_HIGH_VOLTAGE'],
      },
      {
        id: ids.technicians.tomReed,
        dealership_id: ids.dealerships.northsideMotors,
        name: 'Tom Reed',
        qualifications: ['GENERAL'],
      },
      {
        id: ids.technicians.minhTran,
        dealership_id: ids.dealerships.saigonAutoService,
        name: 'Minh Tran',
        qualifications: ['GENERAL', 'BRAKES'],
      },
      {
        id: ids.technicians.lanPham,
        dealership_id: ids.dealerships.saigonAutoService,
        name: 'Lan Pham',
        qualifications: ['GENERAL', 'EV_HIGH_VOLTAGE'],
      },
    ];

    await trx
      .insertInto('technician')
      .values(technicians.map(({ id, dealership_id, name }) => ({ id, dealership_id, name })))
      .onConflict((oc) => oc.doNothing())
      .execute();

    await trx
      .insertInto('technician_qualification')
      .values(
        technicians.flatMap(({ id, qualifications }) =>
          qualifications.map((code) => ({ technician_id: id, qualification_code: code })),
        ),
      )
      .onConflict((oc) => oc.doNothing())
      .execute();

    await trx
      .insertInto('customer')
      .values([
        {
          id: ids.customers.samCarter,
          full_name: 'Sam Carter',
          email: 'sam.carter@example.com',
          phone: '+44 7700 900101',
        },
        {
          id: ids.customers.jordanBlake,
          full_name: 'Jordan Blake',
          email: 'jordan.blake@example.com',
          phone: '+44 7700 900102',
        },
        {
          id: ids.customers.linhNguyen,
          full_name: 'Linh Nguyen',
          email: 'linh.nguyen@example.com',
        },
        { id: ids.customers.baoTran, full_name: 'Bao Tran', email: 'bao.tran@example.com' },
      ])
      .onConflict((oc) => oc.doNothing())
      .execute();

    await trx
      .insertInto('vehicle')
      .values([
        {
          id: ids.vehicles.samCarterFocus,
          customer_id: ids.customers.samCarter,
          vin: 'SEEDVHC0000000001',
          make: 'Ford',
          model: 'Focus',
          model_year: 2021,
        },
        {
          id: ids.vehicles.jordanBlakeModel3,
          customer_id: ids.customers.jordanBlake,
          vin: 'SEEDVHC0000000002',
          make: 'Tesla',
          model: 'Model 3',
          model_year: 2023,
        },
        {
          id: ids.vehicles.linhNguyenVios,
          customer_id: ids.customers.linhNguyen,
          vin: 'SEEDVHC0000000003',
          make: 'Toyota',
          model: 'Vios',
          model_year: 2020,
        },
        {
          id: ids.vehicles.baoTranVf8,
          customer_id: ids.customers.baoTran,
          vin: 'SEEDVHC0000000004',
          make: 'VinFast',
          model: 'VF 8',
          model_year: 2024,
        },
      ])
      .onConflict((oc) => oc.doNothing())
      .execute();
  });
}

async function main(): Promise<void> {
  const config = validateConfig(process.env);
  const db = createKysely(config.databaseUrl, 1);
  try {
    await seed(db);
    console.log('seed data in place');
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('seed failed', error);
    process.exit(1);
  });
}
