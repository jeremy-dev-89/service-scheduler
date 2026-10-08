import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ValidationIssueDto {
  @ApiProperty({ example: 'startsAt' })
  field!: string;

  @ApiProperty({
    example:
      'startsAt must be an ISO 8601 date-time with an explicit offset or Z, for example 2026-10-20T09:00:00+01:00',
  })
  message!: string;
}

/** RFC 9457 problem details. Served as application/problem+json. */
export class ProblemDetailsDto {
  @ApiProperty({ example: '/problems/slot-unavailable' })
  type!: string;

  @ApiProperty({ example: 'Requested slot is unavailable' })
  title!: string;

  @ApiProperty({ example: 409 })
  status!: number;

  @ApiProperty({ example: 'SLOT_UNAVAILABLE', description: 'Stable code for clients to switch on' })
  code!: string;

  @ApiProperty({
    example:
      'No qualified technician and service bay are both free from 09:00 to 11:00 (Europe/London).',
  })
  detail!: string;

  @ApiProperty({ example: '/appointments' })
  instance!: string;

  @ApiProperty({ example: 'c0a8f3e2-7d4b-4c1a-9f0e-5b6a7c8d9e0f' })
  requestId!: string;

  @ApiPropertyOptional({ type: [ValidationIssueDto], description: 'Only for VALIDATION_FAILED' })
  errors?: ValidationIssueDto[];

  @ApiPropertyOptional({
    type: [String],
    example: ['2026-10-20T11:00:00+01:00', '2026-10-20T11:15:00+01:00'],
    description: 'Only for SLOT_UNAVAILABLE: other local start times that are free',
  })
  alternatives?: string[];
}
