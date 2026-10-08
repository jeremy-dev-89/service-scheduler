import { ApiProperty } from '@nestjs/swagger';
import { toLocalIso } from '../../domain/opening-hours';
import type { Appointment, AppointmentStatus } from '../../domain/types';

const UUID = { format: 'uuid', example: '8b1f0c2e-0000-4000-8000-000000000001' } as const;

export class DealershipSummary {
  @ApiProperty(UUID)
  id!: string;

  @ApiProperty({ example: 'Northside Motors' })
  name!: string;

  @ApiProperty({ example: 'Europe/London', description: 'IANA time zone of the dealership' })
  timeZone!: string;
}

export class CustomerSummary {
  @ApiProperty({ ...UUID, example: '8b1f0c2e-0000-4000-8000-000000000101' })
  id!: string;

  @ApiProperty({ example: 'Sam Carter', description: 'Only the name: no contact details' })
  fullName!: string;
}

export class VehicleSummary {
  @ApiProperty({ ...UUID, example: '8b1f0c2e-0000-4000-8000-000000000201' })
  id!: string;

  @ApiProperty({ example: 'SEEDVHC0000000001' })
  vin!: string;

  @ApiProperty({ example: 'Ford' })
  make!: string;

  @ApiProperty({ example: 'Focus' })
  model!: string;
}

export class ServiceTypeSummary {
  @ApiProperty({ ...UUID, example: '8b1f0c2e-0000-4000-8000-000000000302' })
  id!: string;

  @ApiProperty({ example: 'BRAKE_REPLACEMENT' })
  code!: string;

  @ApiProperty({ example: 'Brake replacement' })
  name!: string;

  @ApiProperty({ example: 120 })
  durationMinutes!: number;
}

export class ServiceBaySummary {
  @ApiProperty({ ...UUID, example: '8b1f0c2e-0000-4000-8000-000000000401' })
  id!: string;

  @ApiProperty({ example: 'Bay 1' })
  name!: string;
}

export class TechnicianSummary {
  @ApiProperty({ ...UUID, example: '8b1f0c2e-0000-4000-8000-000000000501' })
  id!: string;

  @ApiProperty({ example: 'Alex Morgan' })
  name!: string;
}

/** The appointment as returned by POST /appointments and GET /appointments/{id}. */
export class AppointmentResponse {
  @ApiProperty({ ...UUID, example: '0f6c1d7e-3a52-4b8e-9c1f-2d4e5f6a7b8c' })
  id!: string;

  @ApiProperty({ enum: ['CONFIRMED', 'CANCELLED'], example: 'CONFIRMED' })
  status!: AppointmentStatus;

  @ApiProperty({ format: 'date-time', example: '2026-10-20T08:00:00.000Z', description: 'UTC' })
  startsAt!: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-10-20T10:00:00.000Z',
    description: 'UTC; the period is half-open [startsAt, endsAt)',
  })
  endsAt!: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-10-20T09:00:00+01:00',
    description: 'startsAt in the dealership time zone',
  })
  localStartsAt!: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-10-20T11:00:00+01:00',
    description: 'endsAt in the dealership time zone',
  })
  localEndsAt!: string;

  @ApiProperty({ type: DealershipSummary })
  dealership!: DealershipSummary;

  @ApiProperty({ type: CustomerSummary })
  customer!: CustomerSummary;

  @ApiProperty({ type: VehicleSummary })
  vehicle!: VehicleSummary;

  @ApiProperty({ type: ServiceTypeSummary })
  serviceType!: ServiceTypeSummary;

  @ApiProperty({ type: ServiceBaySummary })
  serviceBay!: ServiceBaySummary;

  @ApiProperty({ type: TechnicianSummary })
  technician!: TechnicianSummary;

  @ApiProperty({ format: 'date-time', example: '2026-10-08T14:03:12.000Z' })
  createdAt!: string;
}

/** UTC instants plus the same instants in the dealership's zone. Only the customer's name. */
export function toAppointmentResponse(appointment: Appointment): AppointmentResponse {
  const { period, dealership } = appointment;
  return {
    id: appointment.id,
    status: appointment.status,
    startsAt: period.start.toISOString(),
    endsAt: period.end.toISOString(),
    localStartsAt: toLocalIso(period.start, dealership.timeZone),
    localEndsAt: toLocalIso(period.end, dealership.timeZone),
    dealership: { id: dealership.id, name: dealership.name, timeZone: dealership.timeZone },
    customer: { id: appointment.customer.id, fullName: appointment.customer.fullName },
    vehicle: {
      id: appointment.vehicle.id,
      vin: appointment.vehicle.vin,
      make: appointment.vehicle.make,
      model: appointment.vehicle.model,
    },
    serviceType: {
      id: appointment.serviceType.id,
      code: appointment.serviceType.code,
      name: appointment.serviceType.name,
      durationMinutes: appointment.serviceType.durationMinutes,
    },
    serviceBay: { id: appointment.serviceBay.id, name: appointment.serviceBay.name },
    technician: { id: appointment.technician.id, name: appointment.technician.name },
    createdAt: appointment.createdAt.toISOString(),
  };
}
