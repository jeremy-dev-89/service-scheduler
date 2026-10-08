import type { Period } from './period';

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type IsoDayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Opening hours for one weekday, as local wall-clock times "HH:mm" or "HH:mm:ss". */
export interface DailyOpeningHours {
  readonly isoDayOfWeek: number;
  readonly opensAt: string;
  readonly closesAt: string;
}

/** At most one entry per weekday; a missing weekday means closed. */
export type WeeklyOpeningHours = readonly DailyOpeningHours[];

export interface Dealership {
  readonly id: string;
  readonly name: string;
  /** IANA time zone, e.g. Europe/London. */
  readonly timeZone: string;
  readonly openingHours: WeeklyOpeningHours;
}

export interface Customer {
  readonly id: string;
  readonly fullName: string;
}

export interface Vehicle {
  readonly id: string;
  readonly customerId: string;
  readonly vin: string;
  readonly make: string;
  readonly model: string;
}

export interface ServiceType {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly durationMinutes: number;
  readonly requiredQualificationCode: string;
}

export interface ServiceBay {
  readonly id: string;
  readonly name: string;
}

export interface Technician {
  readonly id: string;
  readonly name: string;
}

export type AppointmentStatus = 'CONFIRMED' | 'CANCELLED';

/** A persisted appointment with the records it associates (A3). */
export interface Appointment {
  readonly id: string;
  readonly status: AppointmentStatus;
  readonly period: Period;
  readonly dealership: Pick<Dealership, 'id' | 'name' | 'timeZone'>;
  readonly customer: Customer;
  readonly vehicle: Pick<Vehicle, 'id' | 'vin' | 'make' | 'model'>;
  readonly serviceType: Pick<ServiceType, 'id' | 'code' | 'name' | 'durationMinutes'>;
  readonly serviceBay: ServiceBay;
  readonly technician: Technician;
  readonly createdAt: Date;
}

/** The resources a confirmed appointment holds, and for how long. */
export interface ResourceBooking {
  readonly serviceBayId: string;
  readonly technicianId: string;
  readonly period: Period;
}
