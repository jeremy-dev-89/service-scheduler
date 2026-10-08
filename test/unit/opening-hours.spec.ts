import { fitsWithinOpeningHours, toLocalIso } from '../../src/domain/opening-hours';
import { Period } from '../../src/domain/period';
import type { WeeklyOpeningHours } from '../../src/domain/types';

const weekdays = (opensAt: string, closesAt: string): WeeklyOpeningHours =>
  [1, 2, 3, 4, 5].map((isoDayOfWeek) => ({ isoDayOfWeek, opensAt, closesAt }));

const everyDay = (opensAt: string, closesAt: string): WeeklyOpeningHours =>
  [1, 2, 3, 4, 5, 6, 7].map((isoDayOfWeek) => ({ isoDayOfWeek, opensAt, closesAt }));

const fits = (startIso: string, minutes: number, hours: WeeklyOpeningHours, zone: string) =>
  fitsWithinOpeningHours(Period.of(new Date(startIso), minutes), hours, zone);

describe('fitsWithinOpeningHours', () => {
  // Europe/London is on BST (+01:00) until Sun 25 Oct 2026; Tue 13 Oct is a weekday.
  const london = weekdays('08:00', '18:00');

  it('UT-OH-01 a period inside opening hours fits', () => {
    expect(fits('2026-10-13T10:00:00+01:00', 60, london, 'Europe/London')).toBe(true);
  });

  it('UT-OH-02 a period ending exactly at closing time fits', () => {
    expect(fits('2026-10-13T17:00:00+01:00', 60, london, 'Europe/London')).toBe(true);
  });

  it('UT-OH-03 a period ending one minute after closing does not fit', () => {
    expect(fits('2026-10-13T17:01:00+01:00', 60, london, 'Europe/London')).toBe(false);
  });

  it('UT-OH-04 a closed day does not fit', () => {
    // Sat 17 Oct 2026: no hours for weekday 6.
    expect(fits('2026-10-17T10:00:00+01:00', 60, london, 'Europe/London')).toBe(false);
  });

  it('UT-OH-05 Asia/Ho_Chi_Minh 07:30–17:30: 00:30Z (07:30 local) fits, 00:00Z (07:00 local) does not', () => {
    const saigon = [1, 2, 3, 4, 5, 6].map((isoDayOfWeek) => ({
      isoDayOfWeek,
      opensAt: '07:30',
      closesAt: '17:30',
    }));

    expect(fits('2026-10-13T00:30:00Z', 60, saigon, 'Asia/Ho_Chi_Minh')).toBe(true);
    expect(fits('2026-10-13T00:00:00Z', 60, saigon, 'Asia/Ho_Chi_Minh')).toBe(false);
  });

  it('UT-OH-06 Europe/London 08:00–18:00 daily around the 25 Oct 2026 clock change: 07:30Z fits on Sat 24 Oct but not on Mon 26 Oct', () => {
    const daily = everyDay('08:00', '18:00');

    // Sat 24 Oct, BST: 07:30Z is 08:30 local.
    expect(toLocalIso(new Date('2026-10-24T07:30:00Z'), 'Europe/London')).toBe(
      '2026-10-24T08:30:00+01:00',
    );
    expect(fits('2026-10-24T07:30:00Z', 60, daily, 'Europe/London')).toBe(true);

    // Mon 26 Oct, GMT: 07:30Z is 07:30 local, before opening.
    expect(toLocalIso(new Date('2026-10-26T07:30:00Z'), 'Europe/London')).toBe(
      '2026-10-26T07:30:00+00:00',
    );
    expect(fits('2026-10-26T07:30:00Z', 60, daily, 'Europe/London')).toBe(false);
  });

  it('uses the new offset on the day of the clock change itself (Sun 25 Oct)', () => {
    const daily = everyDay('08:00', '18:00');

    expect(fits('2026-10-25T08:00:00Z', 60, daily, 'Europe/London')).toBe(true);
    expect(fits('2026-10-25T07:30:00Z', 60, daily, 'Europe/London')).toBe(false);
    expect(fits('2026-10-25T17:00:00Z', 60, daily, 'Europe/London')).toBe(true);
    expect(fits('2026-10-25T17:01:00Z', 60, daily, 'Europe/London')).toBe(false);
  });

  it('rejects a period that starts before opening', () => {
    expect(fits('2026-10-13T07:59:00+01:00', 30, london, 'Europe/London')).toBe(false);
  });

  it('rejects a period that runs past midnight into the next day', () => {
    const lateNight = everyDay('18:00', '23:59');

    expect(fits('2026-10-13T23:30:00+01:00', 60, lateNight, 'Europe/London')).toBe(false);
  });

  it('evaluates the weekday in the dealership zone, not in UTC', () => {
    // Saigon is UTC+07:00, so 23:30Z is 06:30 on the next local day.
    const saigonMonToSat = [1, 2, 3, 4, 5, 6].map((isoDayOfWeek) => ({
      isoDayOfWeek,
      opensAt: '06:00',
      closesAt: '17:30',
    }));

    // In UTC this is a Saturday (open); locally it is Sunday (closed).
    expect(fits('2026-10-17T23:30:00Z', 60, saigonMonToSat, 'Asia/Ho_Chi_Minh')).toBe(false);
    // In UTC this is a Sunday; locally it is Monday 06:30 (open).
    expect(fits('2026-10-18T23:30:00Z', 60, saigonMonToSat, 'Asia/Ho_Chi_Minh')).toBe(true);
  });

  it('accepts seconds in stored opening hours (PostgreSQL time format)', () => {
    const fromDatabase = weekdays('08:00:00', '18:00:00');

    expect(fits('2026-10-13T17:00:00+01:00', 60, fromDatabase, 'Europe/London')).toBe(true);
  });

  it('throws on an unknown time zone', () => {
    expect(() => fits('2026-10-13T10:00:00Z', 60, london, 'Mars/Olympus_Mons')).toThrow(RangeError);
  });
});
