import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AppointmentsController } from './api/appointments.controller';
import { AvailabilityController } from './api/availability.controller';
import { HealthController } from './api/health.controller';
import { MetricsController } from './api/metrics.controller';
import { ProblemDetailsFilter } from './api/problem-details.filter';
import { assignRequestId, RequestIdMiddleware } from './api/request-id';
import { createValidationPipe } from './api/validation.pipe';
import { BookAppointmentUseCase } from './application/book-appointment.use-case';
import { CancelAppointmentUseCase } from './application/cancel-appointment.use-case';
import { GetAppointmentQuery } from './application/get-appointment.query';
import { GetAvailabilityQuery } from './application/get-availability.query';
import {
  APPOINTMENT_REPOSITORY,
  BOOKING_POLICY,
  BOOKING_TELEMETRY,
  type BookingPolicy,
  CLOCK,
  METRICS_EXPORTER,
  SCHEDULING_REPOSITORY,
  SystemClock,
} from './application/ports';
import { ConfigModule } from './config/config.module';
import { APP_CONFIG, type AppConfig } from './config/config.schema';
import { DatabaseModule } from './infrastructure/database/database.module';
import { ObservabilityBookingTelemetry } from './infrastructure/observability/booking-telemetry';
import { loggerParams } from './infrastructure/observability/logger.config';
import { HttpMetricsInterceptor, MetricsRegistry } from './infrastructure/observability/metrics';
import { KyselyAppointmentRepository } from './infrastructure/repositories/appointment.repository';
import { KyselySchedulingRepository } from './infrastructure/repositories/scheduling.repository';

/** Composition root: binds every port to its adapter. */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => loggerParams(config, assignRequestId),
    }),
  ],
  controllers: [
    AppointmentsController,
    AvailabilityController,
    HealthController,
    MetricsController,
  ],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    {
      provide: BOOKING_POLICY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): BookingPolicy => ({
        horizonDays: config.bookingHorizonDays,
        maxAttempts: config.bookingMaxAttempts,
        slotStepMinutes: config.slotStepMinutes,
        alternativesCount: config.alternativesCount,
        alternativesSearchDays: config.alternativesSearchDays,
      }),
    },
    { provide: SCHEDULING_REPOSITORY, useClass: KyselySchedulingRepository },
    { provide: APPOINTMENT_REPOSITORY, useClass: KyselyAppointmentRepository },
    MetricsRegistry,
    { provide: METRICS_EXPORTER, useExisting: MetricsRegistry },
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
    { provide: BOOKING_TELEMETRY, useClass: ObservabilityBookingTelemetry },
    BookAppointmentUseCase,
    CancelAppointmentUseCase,
    GetAppointmentQuery,
    GetAvailabilityQuery,
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
