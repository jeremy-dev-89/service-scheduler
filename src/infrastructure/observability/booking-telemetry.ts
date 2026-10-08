import { Injectable } from '@nestjs/common';
import type { BookingDecision, BookingTelemetry, SpanAttributes } from '../../application/ports';
import { MetricsRegistry } from './metrics';

/** Records booking metrics. */
@Injectable()
export class ObservabilityBookingTelemetry implements BookingTelemetry {
  constructor(private readonly metrics: MetricsRegistry) {}

  span<T>(
    _name: string,
    _attributes: SpanAttributes,
    work: (setAttributes: (attributes: SpanAttributes) => void) => Promise<T>,
  ): Promise<T> {
    return work(() => undefined);
  }

  conflictRetry(resource: 'bay' | 'technician'): void {
    this.metrics.bookingConflictRetries.inc({ resource });
  }

  bookingDecided(decision: BookingDecision): void {
    this.metrics.bookingRequests.inc({ outcome: decision.outcome });
    this.metrics.bookingDuration.observe(decision.durationMs / 1000);
  }
}
