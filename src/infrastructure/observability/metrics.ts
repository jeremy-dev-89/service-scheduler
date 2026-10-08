import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';
import type { BookingOutcome } from '../../application/ports';

// Labels never contain IDs, so cardinality stays bounded.

/** One registry per application instance, so tests can create several apps. */
@Injectable()
export class MetricsRegistry {
  readonly registry = new Registry();

  readonly bookingRequests = new Counter<'outcome'>({
    name: 'booking_requests_total',
    help: 'Booking requests by outcome.',
    labelNames: ['outcome'],
    registers: [this.registry],
  });

  readonly bookingConflictRetries = new Counter<'resource'>({
    name: 'booking_conflict_retries_total',
    help: 'Inserts that lost a race on a bay or technician and moved to the next candidate pair.',
    labelNames: ['resource'],
    registers: [this.registry],
  });

  readonly bookingDuration = new Histogram({
    name: 'booking_duration_seconds',
    help: 'Time to decide a booking request, from validation to response.',
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [this.registry],
  });

  readonly httpRequestDuration = new Histogram<'method' | 'route' | 'status_code'>({
    name: 'http_server_request_duration_seconds',
    help: 'HTTP request duration by method, route template and status code.',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
    // Expose every outcome and resource from the start, at zero.
    const outcomes: BookingOutcome[] = [
      'confirmed',
      'slot_unavailable',
      'vehicle_already_booked',
      'invalid',
      'not_found',
      'error',
    ];
    outcomes.forEach((outcome) => this.bookingRequests.inc({ outcome }, 0));
    (['bay', 'technician'] as const).forEach((resource) =>
      this.bookingConflictRetries.inc({ resource }, 0),
    );
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
