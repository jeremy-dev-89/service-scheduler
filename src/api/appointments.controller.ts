import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { BookAppointmentUseCase } from '../application/book-appointment.use-case';
import { CancelAppointmentUseCase } from '../application/cancel-appointment.use-case';
import { GetAppointmentQuery } from '../application/get-appointment.query';
import { type AppointmentResponse, toAppointmentResponse } from './dto/appointment.response';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { IDEMPOTENT_REPLAYED_HEADER, requestFingerprint, validIdempotencyKey } from './idempotency';
import { uuidParam } from './validation.pipe';

@Controller('appointments')
export class AppointmentsController {
  constructor(
    private readonly bookAppointment: BookAppointmentUseCase,
    private readonly getAppointment: GetAppointmentQuery,
    private readonly cancelAppointment: CancelAppointmentUseCase,
  ) {}

  /** A1 + A2: books a bay and a qualified technician for the whole service. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: CreateAppointmentDto,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AppointmentResponse> {
    const idempotencyKey = validIdempotencyKey(idempotencyKeyHeader);
    const { appointment, replayed } = await this.bookAppointment.execute({
      dealershipId: body.dealershipId,
      customerId: body.customerId,
      vehicleId: body.vehicleId,
      serviceTypeId: body.serviceTypeId,
      // Validated as ISO 8601 with an explicit offset, so Date parses it unambiguously.
      startsAt: new Date(body.startsAt),
      ...(idempotencyKey !== undefined
        ? { idempotency: { key: idempotencyKey, fingerprint: requestFingerprint({ ...body }) } }
        : {}),
    });
    res.setHeader('Location', `/appointments/${appointment.id}`);
    if (replayed) {
      res.status(HttpStatus.OK).setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
    }
    return toAppointmentResponse(appointment);
  }

  /** Cancels the appointment and frees its resources. Idempotent. */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param('id', uuidParam('id')) id: string): Promise<AppointmentResponse> {
    return toAppointmentResponse(await this.cancelAppointment.execute(id));
  }

  /** A3: the persisted appointment record. */
  @Get(':id')
  async findOne(@Param('id', uuidParam('id')) id: string): Promise<AppointmentResponse> {
    return toAppointmentResponse(await this.getAppointment.execute(id));
  }
}
