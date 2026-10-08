import { Inject, Injectable } from '@nestjs/common';
import { AppointmentNotFoundError } from '../domain/errors';
import type { Appointment } from '../domain/types';
import { APPOINTMENT_REPOSITORY, type AppointmentRepository } from './ports';

/** A3: reads a persisted appointment with its associations. */
@Injectable()
export class GetAppointmentQuery {
  constructor(
    @Inject(APPOINTMENT_REPOSITORY) private readonly appointments: AppointmentRepository,
  ) {}

  async execute(appointmentId: string): Promise<Appointment> {
    const appointment = await this.appointments.findById(appointmentId);
    if (!appointment) {
      throw new AppointmentNotFoundError(appointmentId);
    }
    return appointment;
  }
}
