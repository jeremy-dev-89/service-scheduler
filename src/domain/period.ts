const MS_PER_MINUTE = 60_000;

/**
 * A half-open time period [start, end): the start instant is included, the end is not.
 * Back-to-back periods (one ends exactly when the next starts) therefore do not overlap.
 * Immutable; instants are UTC.
 */
export class Period {
  private constructor(
    private readonly startMs: number,
    private readonly endMs: number,
  ) {}

  /** [start, start + minutes). Rejects zero, negative or non-finite durations. */
  static of(start: Date, minutes: number): Period {
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new RangeError(`A period needs a positive duration, got ${minutes} minutes`);
    }
    return Period.between(start, new Date(start.getTime() + minutes * MS_PER_MINUTE));
  }

  /** [start, end). Rejects an end that is not after the start. */
  static between(start: Date, end: Date): Period {
    const startMs = start.getTime();
    const endMs = end.getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      throw new RangeError('A period needs valid start and end instants');
    }
    if (endMs <= startMs) {
      throw new RangeError('A period must end after it starts');
    }
    return new Period(startMs, endMs);
  }

  get start(): Date {
    return new Date(this.startMs);
  }

  get end(): Date {
    return new Date(this.endMs);
  }

  get durationMinutes(): number {
    return (this.endMs - this.startMs) / MS_PER_MINUTE;
  }

  overlaps(other: Period): boolean {
    return this.startMs < other.endMs && other.startMs < this.endMs;
  }
}
