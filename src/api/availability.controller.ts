import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { GetAvailabilityQuery } from '../application/get-availability.query';
import { AvailabilityQueryDto, AvailabilityResponse } from './dto/availability.dto';
import { ApiProblems } from './openapi';
import { uuidParam } from './validation.pipe';

@ApiTags('availability')
@Controller('dealerships')
export class AvailabilityController {
  constructor(private readonly getAvailability: GetAvailabilityQuery) {}

  /** Start times on a local date when a bay and a qualified technician are both free. */
  @Get(':dealershipId/availability')
  @ApiOperation({
    summary: 'Free start times for a service on a local date',
    description:
      'Every SLOT_STEP_MINUTES from opening time while the service still ends by closing ' +
      'time, keeping starts when a bay and a qualified technician are both free. A snapshot: ' +
      'booking a listed start can still return 409 if someone else books it first.',
  })
  @ApiParam({ name: 'dealershipId', format: 'uuid' })
  @ApiOkResponse({ type: AvailabilityResponse })
  @ApiProblems(
    '/dealerships/{dealershipId}/availability',
    'VALIDATION_FAILED',
    'DEALERSHIP_NOT_FOUND',
    'SERVICE_TYPE_NOT_FOUND',
  )
  async availability(
    @Param('dealershipId', uuidParam('dealershipId')) dealershipId: string,
    @Query() query: AvailabilityQueryDto,
  ): Promise<AvailabilityResponse> {
    const availability = await this.getAvailability.execute({
      dealershipId,
      serviceTypeId: query.serviceTypeId,
      date: query.date,
    });
    return { ...availability, availableStarts: [...availability.availableStarts] };
  }
}
