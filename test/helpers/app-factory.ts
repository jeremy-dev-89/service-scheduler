import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'supertest';
import { AppModule } from '../../src/app.module';
import { CLOCK, type Clock } from '../../src/application/ports';
import { APP_CONFIG, validateConfig } from '../../src/config/config.schema';

/** "Now" for every acceptance and concurrency test: Monday 12 Oct 2026, 10:00 in London. */
export const FIXED_NOW = new Date('2026-10-12T09:00:00Z');

export class FixedClock implements Clock {
  constructor(private readonly instant: Date) {}

  now(): Date {
    return new Date(this.instant.getTime());
  }
}

/**
 * Builds the real application in-process against the Testcontainers database,
 * with a fixed clock and a 20-connection pool, listening on a random port.
 */
export async function createTestApp(
  options: { now?: Date; env?: Record<string, string> } = {},
): Promise<INestApplication> {
  const config = validateConfig({
    ...process.env,
    NODE_ENV: 'test',
    DB_POOL_MAX: '20',
    LOG_LEVEL: 'silent',
    ...options.env,
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(CLOCK)
    .useValue(new FixedClock(options.now ?? FIXED_NOW))
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0);
  return app;
}

/** Asserts an RFC 9457 problem details response with the given status and code. */
export function expectProblem(res: Response, status: number, code: string): void {
  expect({ status: res.status, code: res.body?.code }).toEqual({ status, code });
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  expect(res.body).toMatchObject({
    type: expect.any(String),
    title: expect.any(String),
    status,
    code,
    requestId: expect.any(String),
  });
  expect(JSON.stringify(res.body)).not.toMatch(/stack|at .*\(.*:\d+:\d+\)/i);
}
