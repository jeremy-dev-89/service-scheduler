import { IsISO8601, IsUUID, Matches } from 'class-validator';

export class AvailabilityQueryDto {
  @IsUUID()
  serviceTypeId!: string;

  @IsISO8601({ strict: true }, { message: 'date must be a valid calendar date, YYYY-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be a local date, YYYY-MM-DD' })
  date!: string;
}

export interface AvailabilityResponse {
  dealershipId: string;
  serviceTypeId: string;
  date: string;
  timeZone: string;
  slotStepMinutes: number;
  availableStarts: string[];
}
