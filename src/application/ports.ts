/** The only source of "now" for business rules. Tests inject a fixed clock. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('Clock');

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Answers whether the service can reach its dependencies. */
export interface ReadinessCheck {
  isReady(): Promise<boolean>;
}

export const READINESS_CHECK = Symbol('ReadinessCheck');
