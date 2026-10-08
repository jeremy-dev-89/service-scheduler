import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { PinoLogger } from 'nestjs-pino';
import type { BookingDecision, BookingTelemetry, SpanAttributes } from '../../application/ports';
import { shutdownTracing } from '../../tracing';
import { MetricsRegistry } from './metrics';

const tracer = trace.getTracer('unified-service-scheduler');

/**
 * Metrics, the booking.decided log line and trace spans for bookings. Spans are no-ops
 * unless tracing is enabled. Everything recorded here is an ID or a count.
 */
@Injectable()
export class ObservabilityBookingTelemetry implements BookingTelemetry, OnApplicationShutdown {
  constructor(
    private readonly metrics: MetricsRegistry,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('BookAppointment');
  }

  span<T>(
    name: string,
    attributes: SpanAttributes,
    work: (setAttributes: (attributes: SpanAttributes) => void) => Promise<T>,
  ): Promise<T> {
    return tracer.startActiveSpan(name, { attributes }, async (span) => {
      try {
        return await work((more) => span.setAttributes(more));
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).name });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  conflictRetry(resource: 'bay' | 'technician'): void {
    this.metrics.bookingConflictRetries.inc({ resource });
  }

  bookingDecided(decision: BookingDecision): void {
    this.metrics.bookingRequests.inc({ outcome: decision.outcome });
    this.metrics.bookingDuration.observe(decision.durationMs / 1000);
    this.logger.info(
      {
        event: 'booking.decided',
        outcome: decision.outcome,
        errorCode: decision.errorCode ?? null,
        retries: decision.retries,
        dealershipId: decision.dealershipId,
        serviceTypeId: decision.serviceTypeId,
        appointmentId: decision.appointmentId ?? null,
        durationMs: decision.durationMs,
      },
      'booking.decided',
    );
  }

  /** Flushes pending spans on shutdown (app.enableShutdownHooks()). */
  async onApplicationShutdown(): Promise<void> {
    await shutdownTracing();
  }
}
