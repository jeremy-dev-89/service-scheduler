import { DateTime } from 'luxon';
import { hoursForWeekday, openingWindow, toLocalDateTime } from './opening-hours';
import { Period } from './period';
import type { DailyOpeningHours, ResourceBooking, WeeklyOpeningHours } from './types';

export interface AvailableStartsInput {
  /** Local calendar date in the dealership's zone, YYYY-MM-DD. */
  readonly date: string;
  /** Opening hours for that date's weekday; undefined when the dealership is closed. */
  readonly openingHours: DailyOpeningHours | undefined;
  readonly timeZone: string;
  readonly durationMinutes: number;
  readonly stepMinutes: number;
  /** Every bay of the dealership. */
  readonly bayIds: readonly string[];
  /** Technicians of the dealership who hold the service type's qualification. */
  readonly technicianIds: readonly string[];
  /** Confirmed appointments that may overlap the day. */
  readonly bookings: readonly ResourceBooking[];
  /** Periods when the vehicle is already booked; used when computing alternatives. */
  readonly vehicleBusy?: readonly Period[];
  readonly now: Date;
  /** Latest bookable start (the booking horizon, AS11); later starts are left out. */
  readonly latestStart?: Date;
}

/**
 * Start times on one local day at which some bay and some qualified technician are both
 * free for the whole service, stepping from opening time every `stepMinutes` while the
 * service still ends by closing time. Starts that are not in the future are skipped.
 * Returned in the dealership's zone, so each carries that day's UTC offset.
 */
export function computeAvailableStarts(input: AvailableStartsInput): DateTime<true>[] {
  if (input.stepMinutes <= 0 || input.durationMinutes <= 0) {
    throw new RangeError('Step and duration must be positive');
  }
  if (!input.openingHours) {
    return [];
  }
  const day = DateTime.fromISO(input.date, { zone: input.timeZone });
  if (!day.isValid) {
    throw new RangeError(`Invalid date "${input.date}" or time zone "${input.timeZone}"`);
  }

  const { opens, closes } = openingWindow(day, input.openingHours);
  const nowMs = input.now.getTime();
  const latestStartMs = input.latestStart?.getTime() ?? Number.POSITIVE_INFINITY;
  const starts: DateTime<true>[] = [];

  for (let start = opens; ; start = start.plus({ minutes: input.stepMinutes })) {
    const end = start.plus({ minutes: input.durationMinutes });
    if (end > closes || start.toMillis() > latestStartMs) {
      break;
    }
    if (start.toMillis() <= nowMs) {
      continue;
    }
    const period = Period.between(start.toJSDate(), end.toJSDate());
    if (input.vehicleBusy?.some((busy) => busy.overlaps(period))) {
      continue;
    }
    if (hasFreeBayAndTechnician(period, input)) {
      starts.push(start);
    }
  }
  return starts;
}

function hasFreeBayAndTechnician(
  period: Period,
  input: Pick<AvailableStartsInput, 'bayIds' | 'technicianIds' | 'bookings'>,
): boolean {
  const busyBays = new Set<string>();
  const busyTechnicians = new Set<string>();
  for (const booking of input.bookings) {
    if (booking.period.overlaps(period)) {
      busyBays.add(booking.serviceBayId);
      busyTechnicians.add(booking.technicianId);
    }
  }
  return (
    input.bayIds.some((id) => !busyBays.has(id)) &&
    input.technicianIds.some((id) => !busyTechnicians.has(id))
  );
}

export interface AlternativesInput extends Omit<AvailableStartsInput, 'date' | 'openingHours'> {
  readonly requestedStart: Date;
  readonly weeklyHours: WeeklyOpeningHours;
  /** How many alternatives to return. */
  readonly count: number;
  /** How many days after the requested day to scan. */
  readonly searchDays: number;
}

/**
 * The instants `findAlternatives` may look at: from the start of the requested local day
 * to the end of the last searched day. Used to load bookings in one query.
 */
export function alternativesWindow(
  requestedStart: Date,
  timeZone: string,
  searchDays: number,
): Period {
  const firstDay = toLocalDateTime(requestedStart, timeZone).startOf('day');
  const afterLastDay = firstDay.plus({ days: searchDays + 1 });
  return Period.between(firstDay.toJSDate(), afterLastDay.toJSDate());
}

/**
 * The first `count` available starts at or after the requested start (so rounded up to
 * the next step), scanning the rest of the requested day and up to `searchDays` more days.
 */
export function findAlternatives(input: AlternativesInput): DateTime<true>[] {
  const firstDay = toLocalDateTime(input.requestedStart, input.timeZone).startOf('day');
  const requestedMs = input.requestedStart.getTime();
  const found: DateTime<true>[] = [];

  for (let offset = 0; offset <= input.searchDays && found.length < input.count; offset += 1) {
    const day = firstDay.plus({ days: offset });
    const starts = computeAvailableStarts({
      ...input,
      date: day.toISODate(),
      openingHours: hoursForWeekday(input.weeklyHours, day.weekday),
    });
    for (const start of starts) {
      if (start.toMillis() >= requestedMs) {
        found.push(start);
        if (found.length === input.count) {
          break;
        }
      }
    }
  }
  return found;
}
