import { IsISO8601, IsUUID, Matches } from 'class-validator';

/** ISO 8601 date-time that ends in Z or an explicit ±HH:mm offset. */
export const DATE_TIME_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const OFFSET_MESSAGE =
  'startsAt must be an ISO 8601 date-time with an explicit offset or Z, for example 2026-10-20T09:00:00+01:00';

export class CreateAppointmentDto {
  @IsUUID()
  dealershipId!: string;

  @IsUUID()
  customerId!: string;

  @IsUUID()
  vehicleId!: string;

  @IsUUID()
  serviceTypeId!: string;

  @IsISO8601({ strict: true, strictSeparator: true }, { message: OFFSET_MESSAGE })
  @Matches(DATE_TIME_WITH_OFFSET, { message: OFFSET_MESSAGE })
  startsAt!: string;
}
