import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsUUID, Matches } from 'class-validator';

export class AvailabilityQueryDto {
  @ApiProperty({ format: 'uuid', example: '8b1f0c2e-0000-4000-8000-000000000302' })
  @IsUUID()
  serviceTypeId!: string;

  @ApiProperty({
    format: 'date',
    example: '2026-10-20',
    description: 'Local date in the dealership time zone',
  })
  @IsISO8601({ strict: true }, { message: 'date must be a valid calendar date, YYYY-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be a local date, YYYY-MM-DD' })
  date!: string;
}

export class AvailabilityResponse {
  @ApiProperty({ format: 'uuid', example: '8b1f0c2e-0000-4000-8000-000000000001' })
  dealershipId!: string;

  @ApiProperty({ format: 'uuid', example: '8b1f0c2e-0000-4000-8000-000000000302' })
  serviceTypeId!: string;

  @ApiProperty({ format: 'date', example: '2026-10-20' })
  date!: string;

  @ApiProperty({ example: 'Europe/London' })
  timeZone!: string;

  @ApiProperty({ example: 15 })
  slotStepMinutes!: number;

  @ApiProperty({
    type: [String],
    example: ['2026-10-20T08:00:00+01:00', '2026-10-20T08:15:00+01:00'],
    description: 'Local start times with the offset for that day; empty on a closed day',
  })
  availableStarts!: string[];
}
