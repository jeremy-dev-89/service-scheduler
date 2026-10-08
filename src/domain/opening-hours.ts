import { DateTime } from 'luxon';
import type { Period } from './period';
import type { DailyOpeningHours, WeeklyOpeningHours } from './types';

const WALL_CLOCK = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** The instant as a Luxon DateTime in the given IANA zone. Throws on an unknown zone. */
export function toLocalDateTime(instant: Date, timeZone: string): DateTime<true> {
  const local = DateTime.fromJSDate(instant, { zone: timeZone });
  if (!local.isValid) {
    throw new RangeError(`Cannot express ${instant.toISOString()} in time zone "${timeZone}"`);
  }
  return local;
}

/** ISO 8601 with the zone's offset and no milliseconds, e.g. 2026-10-20T09:00:00+01:00. */
export function formatLocal(local: DateTime<true>): string {
  return local.toISO({ suppressMilliseconds: true });
}

export function toLocalIso(instant: Date, timeZone: string): string {
  return formatLocal(toLocalDateTime(instant, timeZone));
}

export function hoursForWeekday(
  weeklyHours: WeeklyOpeningHours,
  isoDayOfWeek: number,
): DailyOpeningHours | undefined {
  return weeklyHours.find((hours) => hours.isoDayOfWeek === isoDayOfWeek);
}

/**
 * Opening and closing instants on the local calendar day that contains `localDay`.
 * Luxon resolves the zone offset for each, so a day either side of a daylight-saving
 * change gets the right UTC instants.
 */
export function openingWindow(
  localDay: DateTime<true>,
  hours: DailyOpeningHours,
): { opens: DateTime<true>; closes: DateTime<true> } {
  const day = localDay.startOf('day');
  return { opens: atWallClock(day, hours.opensAt), closes: atWallClock(day, hours.closesAt) };
}

function atWallClock(day: DateTime<true>, time: string): DateTime<true> {
  const match = WALL_CLOCK.exec(time);
  if (!match) {
    throw new RangeError(`Opening hours must be HH:mm or HH:mm:ss, got "${time}"`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  if (hour === 24 && minute === 0 && second === 0) {
    return day.plus({ days: 1 }).startOf('day');
  }
  return day.set({ hour, minute, second, millisecond: 0 });
}

/**
 * True when the whole period lies inside the opening hours of the local day on which it
 * starts (AS6: a service fits inside one day). A closed day never fits.
 */
export function fitsWithinOpeningHours(
  period: Period,
  weeklyHours: WeeklyOpeningHours,
  timeZone: string,
): boolean {
  const localStart = toLocalDateTime(period.start, timeZone);
  const hours = hoursForWeekday(weeklyHours, localStart.weekday);
  if (!hours) {
    return false;
  }
  const { opens, closes } = openingWindow(localStart, hours);
  return period.start.getTime() >= opens.toMillis() && period.end.getTime() <= closes.toMillis();
}
