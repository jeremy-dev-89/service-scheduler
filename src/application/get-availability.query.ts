import { Inject, Injectable } from '@nestjs/common';
import { computeAvailableStarts, latestBookableStart, localDay } from '../domain/availability';
import { DealershipNotFoundError, ServiceTypeNotFoundError } from '../domain/errors';
import { formatLocal, hoursForWeekday } from '../domain/opening-hours';
import {
  BOOKING_POLICY,
  type BookingPolicy,
  CLOCK,
  type Clock,
  SCHEDULING_REPOSITORY,
  type SchedulingRepository,
} from './ports';

export interface AvailabilityRequest {
  readonly dealershipId: string;
  readonly serviceTypeId: string;
  /** Local date in the dealership's zone, YYYY-MM-DD. */
  readonly date: string;
}

export interface Availability {
  readonly dealershipId: string;
  readonly serviceTypeId: string;
  readonly date: string;
  readonly timeZone: string;
  readonly slotStepMinutes: number;
  /** ISO 8601 local times with the dealership's offset. */
  readonly availableStarts: string[];
}

/**
 * Start times on one local day when some bay and some qualified technician are free for
 * the whole service. A snapshot: booking a listed start can still lose a race (409).
 */
@Injectable()
export class GetAvailabilityQuery {
  constructor(
    @Inject(SCHEDULING_REPOSITORY) private readonly scheduling: SchedulingRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BOOKING_POLICY) private readonly policy: BookingPolicy,
  ) {}

  async execute(request: AvailabilityRequest): Promise<Availability> {
    const [dealership, serviceType] = await Promise.all([
      this.scheduling.findDealership(request.dealershipId),
      this.scheduling.findServiceType(request.serviceTypeId),
    ]);
    if (!dealership) throw new DealershipNotFoundError(request.dealershipId);
    if (!serviceType) throw new ServiceTypeNotFoundError(request.serviceTypeId);

    const day = localDay(request.date, dealership.timeZone);
    const [bays, technicians, bookings] = await Promise.all([
      this.scheduling.listBays(dealership.id),
      this.scheduling.listQualifiedTechnicians(
        dealership.id,
        serviceType.requiredQualificationCode,
      ),
      this.scheduling.findConfirmedBookings(dealership.id, day.window),
    ]);
    const now = this.clock.now();

    const starts = computeAvailableStarts({
      date: request.date,
      openingHours: hoursForWeekday(dealership.openingHours, day.isoDayOfWeek),
      timeZone: dealership.timeZone,
      durationMinutes: serviceType.durationMinutes,
      stepMinutes: this.policy.slotStepMinutes,
      bayIds: bays.map((bay) => bay.id),
      technicianIds: technicians.map((technician) => technician.id),
      bookings,
      now,
      latestStart: latestBookableStart(now, this.policy.horizonDays),
    });

    return {
      dealershipId: dealership.id,
      serviceTypeId: serviceType.id,
      date: request.date,
      timeZone: dealership.timeZone,
      slotStepMinutes: this.policy.slotStepMinutes,
      availableStarts: starts.map(formatLocal),
    };
  }
}
