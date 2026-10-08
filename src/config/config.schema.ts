import 'reflect-metadata';
import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export const APP_CONFIG = Symbol('APP_CONFIG');

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

// Reads the raw string: implicit conversion would turn any non-empty string into true.
const toBoolean = ({ key, obj }: { key: string; obj: Record<string, unknown> }): unknown => {
  const raw = obj[key];
  if (raw === 'true' || raw === true) return true;
  if (raw === 'false' || raw === false) return false;
  return raw;
};

/** Every environment variable the service reads, with its default. */
class EnvironmentVariables {
  @IsIn(['development', 'production', 'test'])
  NODE_ENV: string = 'development';

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @Matches(/^postgres(ql)?:\/\/.+/, { message: 'DATABASE_URL must be a postgres:// URL' })
  DATABASE_URL: string = 'postgres://scheduler:scheduler@localhost:5432/scheduler';

  @IsInt()
  @Min(1)
  @Max(100)
  DB_POOL_MAX: number = 10;

  @IsInt()
  @Min(1)
  @Max(365)
  BOOKING_HORIZON_DAYS: number = 90;

  @IsInt()
  @Min(1)
  @Max(20)
  BOOKING_MAX_ATTEMPTS: number = 5;

  @IsInt()
  @Min(1)
  @Max(240)
  SLOT_STEP_MINUTES: number = 15;

  @IsInt()
  @Min(1)
  @Max(20)
  ALTERNATIVES_COUNT: number = 3;

  @IsInt()
  @Min(0)
  @Max(31)
  ALTERNATIVES_SEARCH_DAYS: number = 7;

  @IsIn(LOG_LEVELS)
  LOG_LEVEL: LogLevel = 'info';

  @Transform(toBoolean)
  @IsBoolean()
  OTEL_ENABLED: boolean = false;

  @IsString()
  @IsNotEmpty()
  OTEL_SERVICE_NAME: string = 'unified-service-scheduler';

  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  OTEL_EXPORTER_OTLP_ENDPOINT: string = 'http://localhost:4318';
}

export interface AppConfig {
  readonly nodeEnv: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly dbPoolMax: number;
  readonly bookingHorizonDays: number;
  readonly bookingMaxAttempts: number;
  readonly slotStepMinutes: number;
  readonly alternativesCount: number;
  readonly alternativesSearchDays: number;
  readonly logLevel: LogLevel;
  readonly otelEnabled: boolean;
  readonly otelServiceName: string;
  readonly otelExporterOtlpEndpoint: string;
}

/**
 * Validates the environment and returns typed configuration.
 * Throws on any invalid value, so the app refuses to start.
 */
export function validateConfig(env: NodeJS.ProcessEnv): AppConfig {
  const provided = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value !== ''),
  );
  const vars = plainToInstance(EnvironmentVariables, provided, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });
  const errors = validateSync(vars, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((error) => `${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }

  return Object.freeze({
    nodeEnv: vars.NODE_ENV,
    port: vars.PORT,
    databaseUrl: vars.DATABASE_URL,
    dbPoolMax: vars.DB_POOL_MAX,
    bookingHorizonDays: vars.BOOKING_HORIZON_DAYS,
    bookingMaxAttempts: vars.BOOKING_MAX_ATTEMPTS,
    slotStepMinutes: vars.SLOT_STEP_MINUTES,
    alternativesCount: vars.ALTERNATIVES_COUNT,
    alternativesSearchDays: vars.ALTERNATIVES_SEARCH_DAYS,
    logLevel: vars.LOG_LEVEL,
    otelEnabled: vars.OTEL_ENABLED,
    otelServiceName: vars.OTEL_SERVICE_NAME,
    otelExporterOtlpEndpoint: vars.OTEL_EXPORTER_OTLP_ENDPOINT,
  });
}
