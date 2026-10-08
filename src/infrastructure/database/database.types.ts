import type { ColumnType, Generated } from 'kysely';

/** Nullable column that may be omitted on insert. */
type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>;

/** Column with a database default: optional on insert. */
type WithDefault<T> = ColumnType<T, T | undefined, T>;

export type AppointmentStatusColumn = 'CONFIRMED' | 'CANCELLED';

export interface DealershipTable {
  id: Generated<string>;
  name: string;
  time_zone: string;
  created_at: Generated<Date>;
}

export interface DealershipOpeningHoursTable {
  dealership_id: string;
  iso_day_of_week: number;
  /** PostgreSQL `time`, returned by pg as `HH:MM:SS`. */
  opens_at: string;
  closes_at: string;
}

export interface QualificationTable {
  code: string;
  name: string;
}

export interface ServiceTypeTable {
  id: Generated<string>;
  code: string;
  name: string;
  duration_minutes: number;
  required_qualification_code: string;
}

export interface ServiceBayTable {
  id: Generated<string>;
  dealership_id: string;
  name: string;
}

export interface TechnicianTable {
  id: Generated<string>;
  dealership_id: string;
  name: string;
}

export interface TechnicianQualificationTable {
  technician_id: string;
  qualification_code: string;
}

export interface CustomerTable {
  id: Generated<string>;
  full_name: string;
  email: Nullable<string>;
  phone: Nullable<string>;
  created_at: Generated<Date>;
}

export interface VehicleTable {
  id: Generated<string>;
  customer_id: string;
  vin: string;
  make: string;
  model: string;
  model_year: Nullable<number>;
}

export interface AppointmentTable {
  id: Generated<string>;
  dealership_id: string;
  customer_id: string;
  vehicle_id: string;
  service_type_id: string;
  service_bay_id: string;
  technician_id: string;
  /**
   * `tstzrange`. Written with sql`tstzrange(start, end, '[)')` and read with
   * lower(period) / upper(period); the range string is never parsed.
   */
  period: string;
  status: WithDefault<AppointmentStatusColumn>;
  idempotency_key: Nullable<string>;
  idempotency_fingerprint: Nullable<string>;
  created_at: Generated<Date>;
  cancelled_at: Nullable<Date>;
}

export interface Database {
  dealership: DealershipTable;
  dealership_opening_hours: DealershipOpeningHoursTable;
  qualification: QualificationTable;
  service_type: ServiceTypeTable;
  service_bay: ServiceBayTable;
  technician: TechnicianTable;
  technician_qualification: TechnicianQualificationTable;
  customer: CustomerTable;
  vehicle: VehicleTable;
  appointment: AppointmentTable;
}
