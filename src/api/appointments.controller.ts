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
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { BookAppointmentUseCase } from '../application/book-appointment.use-case';
import { CancelAppointmentUseCase } from '../application/cancel-appointment.use-case';
import { GetAppointmentQuery } from '../application/get-appointment.query';
import { AppointmentResponse, toAppointmentResponse } from './dto/appointment.response';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAYED_HEADER,
  requestFingerprint,
  validIdempotencyKey,
} from './idempotency';
import { ApiProblems } from './openapi';
import { REQUEST_ID_HEADER } from './request-id';
import { uuidParam } from './validation.pipe';

const requestIdHeader = {
  [REQUEST_ID_HEADER]: { description: 'Echo of the request ID', schema: { type: 'string' } },
};

@ApiTags('appointments')
@ApiHeader({
  name: REQUEST_ID_HEADER,
  required: false,
  description: 'Correlation ID; generated when absent and echoed in the response',
})
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
  @ApiOperation({
    summary: 'Book a service appointment',
    description:
      'Confirms the appointment only if a service bay and a qualified technician are both ' +
      'free for the whole service duration. The requested start is never shifted.',
  })
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: false,
    description:
      '1–128 characters. Repeating a request with the same key and body returns the stored ' +
      'appointment with 200 instead of booking again.',
  })
  @ApiCreatedResponse({
    type: AppointmentResponse,
    description: 'Appointment confirmed',
    headers: {
      Location: { description: 'URL of the new appointment', schema: { type: 'string' } },
      ...requestIdHeader,
    },
  })
  @ApiOkResponse({
    type: AppointmentResponse,
    description: 'Replay of an earlier request with the same Idempotency-Key and body',
    headers: {
      [IDEMPOTENT_REPLAYED_HEADER]: { schema: { type: 'string', enum: ['true'] } },
      Location: { description: 'URL of the appointment', schema: { type: 'string' } },
      ...requestIdHeader,
    },
  })
  @ApiProblems(
    '/appointments',
    'VALIDATION_FAILED',
    'DEALERSHIP_NOT_FOUND',
    'CUSTOMER_NOT_FOUND',
    'VEHICLE_NOT_FOUND',
    'SERVICE_TYPE_NOT_FOUND',
    'SLOT_UNAVAILABLE',
    'VEHICLE_ALREADY_BOOKED',
    'VEHICLE_NOT_OWNED_BY_CUSTOMER',
    'START_IN_PAST',
    'BEYOND_BOOKING_HORIZON',
    'OUTSIDE_OPENING_HOURS',
    'IDEMPOTENCY_KEY_REUSED',
  )
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
  @ApiOperation({
    summary: 'Cancel an appointment',
    description:
      'Frees the bay, technician and vehicle for the period. Cancelling a cancelled ' +
      'appointment returns it unchanged.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AppointmentResponse, description: 'The cancelled appointment' })
  @ApiProblems('/appointments/{id}/cancel', 'VALIDATION_FAILED', 'APPOINTMENT_NOT_FOUND')
  async cancel(@Param('id', uuidParam('id')) id: string): Promise<AppointmentResponse> {
    return toAppointmentResponse(await this.cancelAppointment.execute(id));
  }

  /** A3: the persisted appointment record. */
  @Get(':id')
  @ApiOperation({ summary: 'Read an appointment' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AppointmentResponse })
  @ApiProblems('/appointments/{id}', 'VALIDATION_FAILED', 'APPOINTMENT_NOT_FOUND')
  async findOne(@Param('id', uuidParam('id')) id: string): Promise<AppointmentResponse> {
    return toAppointmentResponse(await this.getAppointment.execute(id));
  }
}
