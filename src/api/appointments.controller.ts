import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BookAppointmentUseCase } from '../application/book-appointment.use-case';
import { GetAppointmentQuery } from '../application/get-appointment.query';
import { type AppointmentResponse, toAppointmentResponse } from './dto/appointment.response';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { uuidParam } from './validation.pipe';

@Controller('appointments')
export class AppointmentsController {
  constructor(
    private readonly bookAppointment: BookAppointmentUseCase,
    private readonly getAppointment: GetAppointmentQuery,
  ) {}

  /** A1 + A2: books a bay and a qualified technician for the whole service. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: CreateAppointmentDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AppointmentResponse> {
    const { appointment } = await this.bookAppointment.execute({
      dealershipId: body.dealershipId,
      customerId: body.customerId,
      vehicleId: body.vehicleId,
      serviceTypeId: body.serviceTypeId,
      // Validated as ISO 8601 with an explicit offset, so Date parses it unambiguously.
      startsAt: new Date(body.startsAt),
    });
    res.setHeader('Location', `/appointments/${appointment.id}`);
    return toAppointmentResponse(appointment);
  }

  /** A3: the persisted appointment record. */
  @Get(':id')
  async findOne(@Param('id', uuidParam('id')) id: string): Promise<AppointmentResponse> {
    return toAppointmentResponse(await this.getAppointment.execute(id));
  }
}
