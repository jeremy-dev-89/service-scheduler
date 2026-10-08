import { Inject, Injectable } from '@nestjs/common';
import { AppointmentNotFoundError } from '../domain/errors';
import type { Appointment } from '../domain/types';
import { APPOINTMENT_REPOSITORY, type AppointmentRepository, CLOCK, type Clock } from './ports';

/**
 * Cancels an appointment, which frees its bay, technician and vehicle (AS10).
 * Idempotent: cancelling a CANCELLED appointment changes nothing and returns it as is.
 */
@Injectable()
export class CancelAppointmentUseCase {
  constructor(
    @Inject(APPOINTMENT_REPOSITORY) private readonly appointments: AppointmentRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(appointmentId: string): Promise<Appointment> {
    const existing = await this.appointments.findById(appointmentId);
    if (!existing) {
      throw new AppointmentNotFoundError(appointmentId);
    }
    if (existing.status === 'CANCELLED') {
      return existing;
    }

    // Guarded by status = 'CONFIRMED', so a concurrent cancel keeps the first timestamp.
    await this.appointments.cancel(appointmentId, this.clock.now());
    const cancelled = await this.appointments.findById(appointmentId);
    if (!cancelled) {
      throw new AppointmentNotFoundError(appointmentId);
    }
    return cancelled;
  }
}
