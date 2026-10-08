import { validateConfig } from '../../src/config/config.schema';

describe('validateConfig', () => {
  it('applies the documented defaults when nothing is set', () => {
    const config = validateConfig({});

    expect(config).toMatchObject({
      nodeEnv: 'development',
      port: 3000,
      databaseUrl: 'postgres://scheduler:scheduler@localhost:5432/scheduler',
      dbPoolMax: 10,
      bookingHorizonDays: 90,
      bookingMaxAttempts: 5,
      slotStepMinutes: 15,
      alternativesCount: 3,
      alternativesSearchDays: 7,
      logLevel: 'info',
      otelEnabled: false,
      otelServiceName: 'unified-service-scheduler',
      otelExporterOtlpEndpoint: 'http://localhost:4318',
    });
  });

  it('converts numeric and boolean strings', () => {
    const config = validateConfig({ PORT: '8080', DB_POOL_MAX: '20', OTEL_ENABLED: 'true' });

    expect(config.port).toBe(8080);
    expect(config.dbPoolMax).toBe(20);
    expect(config.otelEnabled).toBe(true);
  });

  it.each([
    ['PORT', 'abc'],
    ['DB_POOL_MAX', '0'],
    ['BOOKING_HORIZON_DAYS', '1.5'],
    ['DATABASE_URL', 'mysql://localhost/db'],
    ['LOG_LEVEL', 'verbose'],
    ['OTEL_ENABLED', 'yes'],
  ])('refuses an invalid %s', (name, value) => {
    expect(() => validateConfig({ [name]: value })).toThrow(
      new RegExp(`Invalid configuration: .*${name}`),
    );
  });
});
