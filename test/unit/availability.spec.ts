import {
  type AvailableStartsInput,
  computeAvailableStarts,
  findAlternatives,
  latestBookableStart,
  localDay,
} from '../../src/domain/availability';
import { formatLocal } from '../../src/domain/opening-hours';
import { Period } from '../../src/domain/period';
import type { ResourceBooking } from '../../src/domain/types';

// Tue 13 Oct 2026 in Europe/London (BST, +01:00), open 08:00–18:00.
const local = (hhmm: string, date = '2026-10-13') => new Date(`${date}T${hhmm}:00+01:00`);
const busy = (from: string, to: string) => Period.between(local(from), local(to));

const base: AvailableStartsInput = {
  date: '2026-10-13',
  openingHours: { isoDayOfWeek: 2, opensAt: '08:00', closesAt: '18:00' },
  timeZone: 'Europe/London',
  durationMinutes: 60,
  stepMinutes: 15,
  bayIds: ['bay-1', 'bay-2'],
  technicianIds: ['tech-1'],
  bookings: [],
  now: new Date('2026-10-12T09:00:00Z'),
};

const starts = (input: Partial<AvailableStartsInput> = {}) =>
  computeAvailableStarts({ ...base, ...input }).map(formatLocal);

const at = (hhmm: string) => `2026-10-13T${hhmm}:00+01:00`;

describe('computeAvailableStarts', () => {
  it('UT-AV-01 yields every step from opening to closing minus duration on a free day', () => {
    const result = starts();

    expect(result).toHaveLength(37); // 08:00 … 17:00 every 15 minutes
    expect(result[0]).toBe(at('08:00'));
    expect(result[1]).toBe(at('08:15'));
    expect(result.at(-1)).toBe(at('17:00'));
  });

  it('UT-AV-02 excludes starts when every bay is busy', () => {
    const bookings: ResourceBooking[] = [
      { serviceBayId: 'bay-1', technicianId: 'other-1', period: busy('10:00', '11:00') },
      { serviceBayId: 'bay-2', technicianId: 'other-2', period: busy('10:00', '11:00') },
    ];

    const result = starts({ bookings });

    // 09:15 would run to 10:15 and overlap; 09:00 ends at 10:00 exactly and is fine.
    expect(result).toContain(at('09:00'));
    for (const blocked of ['09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45']) {
      expect(result).not.toContain(at(blocked));
    }
    expect(result).toContain(at('11:00'));
  });

  it('keeps starts when only one of the bays is busy', () => {
    const bookings: ResourceBooking[] = [
      { serviceBayId: 'bay-1', technicianId: 'other-1', period: busy('10:00', '11:00') },
    ];

    expect(starts({ bookings })).toContain(at('10:00'));
  });

  it('UT-AV-03 excludes starts when only an unqualified technician is free', () => {
    // tech-1 is the only qualified technician; tech-unqualified is free but not passed in.
    const bookings: ResourceBooking[] = [
      { serviceBayId: 'bay-1', technicianId: 'tech-1', period: busy('12:00', '13:00') },
    ];

    const result = starts({ bookings, technicianIds: ['tech-1'] });

    expect(result).not.toContain(at('12:00'));
    expect(result).not.toContain(at('11:15'));
    expect(result).toContain(at('11:00'));
    expect(result).toContain(at('13:00'));
  });

  it('UT-AV-04 excludes starts that are not in the future', () => {
    // Now is 10:10 local: 10:00 is past, 10:15 is the first start in the future.
    const result = starts({ now: new Date('2026-10-13T09:10:00Z') });

    expect(result[0]).toBe(at('10:15'));
  });

  it('UT-AV-04 excludes a start exactly at now', () => {
    const result = starts({ now: new Date('2026-10-13T09:00:00Z') });

    expect(result).not.toContain(at('10:00'));
    expect(result[0]).toBe(at('10:15'));
  });

  it('UT-AV-05 excludes the vehicle busy periods when computing alternatives', () => {
    const result = starts({ vehicleBusy: [busy('12:00', '13:00')] });

    expect(result).toContain(at('11:00'));
    for (const blocked of ['11:15', '11:30', '11:45', '12:00', '12:15', '12:30', '12:45']) {
      expect(result).not.toContain(at(blocked));
    }
    expect(result).toContain(at('13:00'));
  });

  it('returns no starts on a closed day', () => {
    expect(starts({ openingHours: undefined })).toEqual([]);
  });

  it('leaves out starts after the latest bookable start', () => {
    const result = starts({ latestStart: local('09:00') });

    expect(result).toEqual([at('08:00'), at('08:15'), at('08:30'), at('08:45'), at('09:00')]);
  });

  it('carries the GMT offset after the clock change (Sun 25 Oct 2026)', () => {
    const result = computeAvailableStarts({
      ...base,
      date: '2026-10-25',
      openingHours: { isoDayOfWeek: 7, opensAt: '08:00', closesAt: '18:00' },
    }).map(formatLocal);

    expect(result[0]).toBe('2026-10-25T08:00:00+00:00');
    expect(result.at(-1)).toBe('2026-10-25T17:00:00+00:00');
  });
});

describe('findAlternatives', () => {
  const weeklyHours = [1, 2, 3, 4, 5].map((isoDayOfWeek) => ({
    isoDayOfWeek,
    opensAt: '08:00',
    closesAt: '18:00',
  }));
  const { date: _date, openingHours: _hours, ...shared } = base;
  const alternatives = (overrides: Partial<Parameters<typeof findAlternatives>[0]> = {}) =>
    findAlternatives({
      ...shared,
      technicianIds: ['tech-1'],
      bayIds: ['bay-1'],
      weeklyHours,
      requestedStart: local('09:00'),
      count: 3,
      searchDays: 7,
      ...overrides,
    }).map(formatLocal);

  it('returns the next free starts at or after the requested start', () => {
    const bookings: ResourceBooking[] = [
      { serviceBayId: 'bay-1', technicianId: 'tech-1', period: busy('09:00', '11:00') },
    ];

    expect(alternatives({ bookings, durationMinutes: 120 })).toEqual([
      at('11:00'),
      at('11:15'),
      at('11:30'),
    ]);
  });

  it('rounds a requested start up to the next step', () => {
    expect(alternatives({ requestedStart: local('09:07') })[0]).toBe(at('09:15'));
  });

  it('skips the vehicle busy periods', () => {
    const result = alternatives({
      requestedStart: local('11:00'),
      vehicleBusy: [busy('11:00', '12:30')],
    });

    expect(result).toEqual([at('12:30'), at('12:45'), at('13:00')]);
  });

  it('continues on the next open day, skipping the weekend', () => {
    // Fri 16 Oct, requested 16:30 with a 120-minute service: nothing fits that day,
    // Saturday and Sunday are closed, so Monday 19 Oct opens the list.
    const result = alternatives({
      requestedStart: new Date('2026-10-16T16:30:00+01:00'),
      durationMinutes: 120,
    });

    expect(result).toEqual([
      '2026-10-19T08:00:00+01:00',
      '2026-10-19T08:15:00+01:00',
      '2026-10-19T08:30:00+01:00',
    ]);
  });

  it('returns fewer than requested when the search window runs out', () => {
    const result = alternatives({
      requestedStart: new Date('2026-10-16T16:30:00+01:00'),
      durationMinutes: 120,
      searchDays: 2,
    });

    expect(result).toEqual([]);
  });
});

describe('localDay and latestBookableStart', () => {
  it('spans 25 hours on the day the clocks go back, and reports the ISO weekday', () => {
    const { window, isoDayOfWeek } = localDay('2026-10-25', 'Europe/London');

    expect(window.start).toEqual(new Date('2026-10-24T23:00:00Z'));
    expect(window.end).toEqual(new Date('2026-10-26T00:00:00Z'));
    expect(window.durationMinutes).toBe(25 * 60);
    expect(isoDayOfWeek).toBe(7);
  });

  it('rejects an impossible date', () => {
    expect(() => localDay('2026-02-30', 'Europe/London')).toThrow(RangeError);
  });

  it('puts the latest bookable start a whole number of days after now', () => {
    expect(latestBookableStart(new Date('2026-10-12T09:00:00Z'), 90)).toEqual(
      new Date('2027-01-10T09:00:00Z'),
    );
  });
});
