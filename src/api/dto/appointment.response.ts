import { toLocalIso } from '../../domain/opening-hours';
import type { Appointment, AppointmentStatus } from '../../domain/types';

/** The appointment as returned by POST /appointments and GET /appointments/{id}. */
export interface AppointmentResponse {
  id: string;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  localStartsAt: string;
  localEndsAt: string;
  dealership: { id: string; name: string; timeZone: string };
  customer: { id: string; fullName: string };
  vehicle: { id: string; vin: string; make: string; model: string };
  serviceType: { id: string; code: string; name: string; durationMinutes: number };
  serviceBay: { id: string; name: string };
  technician: { id: string; name: string };
  createdAt: string;
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
