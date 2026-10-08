import { Period } from '../../src/domain/period';

const t = (hhmm: string) => new Date(`2026-10-13T${hhmm}:00Z`);
const between = (from: string, to: string) => Period.between(t(from), t(to));

describe('Period (half-open [start, end))', () => {
  const booked = between('10:00', '12:00');

  it('UT-P-01 detects an overlap at the start of a period', () => {
    const other = between('09:00', '10:30');

    expect(booked.overlaps(other)).toBe(true);
    expect(other.overlaps(booked)).toBe(true);
  });

  it('UT-P-02 detects an overlap at the end of a period', () => {
    const other = between('11:30', '13:00');

    expect(booked.overlaps(other)).toBe(true);
    expect(other.overlaps(booked)).toBe(true);
  });

  it('UT-P-03 detects containment in either direction', () => {
    const inner = between('10:30', '11:30');
    const outer = between('09:00', '13:00');

    expect(booked.overlaps(inner)).toBe(true);
    expect(inner.overlaps(booked)).toBe(true);
    expect(booked.overlaps(outer)).toBe(true);
    expect(outer.overlaps(booked)).toBe(true);
  });

  it('UT-P-04 treats identical periods as overlapping', () => {
    expect(booked.overlaps(between('10:00', '12:00'))).toBe(true);
  });

  it('UT-P-05 does not treat adjacent periods (end == start) as overlapping', () => {
    const before = between('08:00', '10:00');
    const after = between('12:00', '14:00');

    expect(booked.overlaps(before)).toBe(false);
    expect(before.overlaps(booked)).toBe(false);
    expect(booked.overlaps(after)).toBe(false);
    expect(after.overlaps(booked)).toBe(false);
  });

  it.each([0, -15, Number.NaN, Number.POSITIVE_INFINITY])(
    'UT-P-06 rejects a duration of %p minutes',
    (minutes) => {
      expect(() => Period.of(t('10:00'), minutes)).toThrow(RangeError);
    },
  );

  it('UT-P-06 rejects an end that is not after the start', () => {
    expect(() => between('10:00', '10:00')).toThrow(RangeError);
    expect(() => between('10:00', '09:00')).toThrow(RangeError);
  });

  it('builds [start, start + minutes) and exposes copies of its instants', () => {
    const period = Period.of(t('10:00'), 90);

    expect(period.start).toEqual(t('10:00'));
    expect(period.end).toEqual(t('11:30'));
    expect(period.durationMinutes).toBe(90);

    period.start.setUTCHours(0);
    expect(period.start).toEqual(t('10:00'));
  });
});
