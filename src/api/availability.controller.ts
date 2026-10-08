import { Controller, Get, Param, Query } from '@nestjs/common';
import { GetAvailabilityQuery } from '../application/get-availability.query';
import { type AvailabilityResponse, AvailabilityQueryDto } from './dto/availability.dto';
import { uuidParam } from './validation.pipe';

@Controller('dealerships')
export class AvailabilityController {
  constructor(private readonly getAvailability: GetAvailabilityQuery) {}

  /** Start times on a local date when a bay and a qualified technician are both free. */
  @Get(':dealershipId/availability')
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
