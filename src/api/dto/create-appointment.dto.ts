import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsUUID, Matches } from 'class-validator';

/** ISO 8601 date-time that ends in Z or an explicit ±HH:mm offset. */
export const DATE_TIME_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const OFFSET_MESSAGE =
  'startsAt must be an ISO 8601 date-time with an explicit offset or Z, for example 2026-10-20T09:00:00+01:00';

export class CreateAppointmentDto {
  @ApiProperty({ format: 'uuid', example: '8b1f0c2e-0000-4000-8000-000000000001' })
  @IsUUID()
  dealershipId!: string;

  @ApiProperty({ format: 'uuid', example: '8b1f0c2e-0000-4000-8000-000000000101' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({
    format: 'uuid',
    example: '8b1f0c2e-0000-4000-8000-000000000201',
    description: 'Must belong to the customer',
  })
  @IsUUID()
  vehicleId!: string;

  @ApiProperty({ format: 'uuid', example: '8b1f0c2e-0000-4000-8000-000000000302' })
  @IsUUID()
  serviceTypeId!: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-10-20T09:00:00+01:00',
    description:
      'Requested start, ISO 8601 with an explicit offset or Z. The time is never shifted: ' +
      'if it is not free the answer is 409 with alternatives.',
  })
  @IsISO8601({ strict: true, strictSeparator: true }, { message: OFFSET_MESSAGE })
  @Matches(DATE_TIME_WITH_OFFSET, { message: OFFSET_MESSAGE })
  startsAt!: string;
}
