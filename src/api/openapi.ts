import { applyDecorators, type INestApplication } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiResponse,
  DocumentBuilder,
  getSchemaPath,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import type { ErrorCode } from '../domain/errors';
import { ProblemDetailsDto } from './dto/problem-details.dto';
import { PROBLEM_CATALOGUE, problemType } from './problem-details.filter';

const API_VERSION = '1.0.0';

const EXAMPLE_DETAIL: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: 'The request is not valid.',
  DEALERSHIP_NOT_FOUND: 'Dealership 8b1f0c2e-0000-4000-8000-000000000009 does not exist.',
  CUSTOMER_NOT_FOUND: 'Customer 8b1f0c2e-0000-4000-8000-000000000109 does not exist.',
  VEHICLE_NOT_FOUND: 'Vehicle 8b1f0c2e-0000-4000-8000-000000000209 does not exist.',
  SERVICE_TYPE_NOT_FOUND: 'Service type 8b1f0c2e-0000-4000-8000-000000000309 does not exist.',
  APPOINTMENT_NOT_FOUND: 'Appointment 0f6c1d7e-3a52-4b8e-9c1f-2d4e5f6a7b8c does not exist.',
  VEHICLE_NOT_OWNED_BY_CUSTOMER:
    'Vehicle 8b1f0c2e-0000-4000-8000-000000000202 does not belong to customer 8b1f0c2e-0000-4000-8000-000000000101.',
  START_IN_PAST: 'The requested start time is not in the future.',
  BEYOND_BOOKING_HORIZON: 'Appointments can be booked at most 90 days ahead.',
  OUTSIDE_OPENING_HOURS:
    "The period 17:00 to 19:00 (Europe/London) is not within the dealership's opening hours on that day.",
  SLOT_UNAVAILABLE:
    'No qualified technician and service bay are both free from 09:00 to 11:00 (Europe/London).',
  VEHICLE_ALREADY_BOOKED:
    'Vehicle 8b1f0c2e-0000-4000-8000-000000000201 already has an appointment that overlaps this period.',
  IDEMPOTENCY_KEY_REUSED: 'This Idempotency-Key was already used with a different request body.',
  INTERNAL_ERROR: 'An unexpected error occurred.',
};

function exampleProblem(code: ErrorCode, instance: string): ProblemDetailsDto {
  const { status, title } = PROBLEM_CATALOGUE[code];
  return {
    type: problemType(code),
    title,
    status,
    code,
    detail: EXAMPLE_DETAIL[code],
    instance,
    requestId: 'c0a8f3e2-7d4b-4c1a-9f0e-5b6a7c8d9e0f',
    ...(code === 'VALIDATION_FAILED'
      ? {
          errors: [
            {
              field: 'startsAt',
              message:
                'startsAt must be an ISO 8601 date-time with an explicit offset or Z, for example 2026-10-20T09:00:00+01:00',
            },
          ],
        }
      : {}),
    ...(code === 'SLOT_UNAVAILABLE'
      ? {
          alternatives: [
            '2026-10-20T11:00:00+01:00',
            '2026-10-20T11:15:00+01:00',
            '2026-10-20T11:30:00+01:00',
          ],
        }
      : {}),
  };
}

/** Documents the problem+json responses an operation can return, with one example per code. */
export function ApiProblems(instance: string, ...codes: ErrorCode[]): MethodDecorator {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of [...codes, 'INTERNAL_ERROR' as const]) {
    const { status } = PROBLEM_CATALOGUE[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  return applyDecorators(
    ApiExtraModels(ProblemDetailsDto),
    ...[...byStatus.entries()].map(([status, statusCodes]) =>
      ApiResponse({
        status,
        description: statusCodes.join(', '),
        content: {
          'application/problem+json': {
            schema: { $ref: getSchemaPath(ProblemDetailsDto) },
            examples: Object.fromEntries(
              statusCodes.map((code) => [code, { value: exampleProblem(code, instance) }]),
            ),
          },
        },
      }),
    ),
  );
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Unified Service Scheduler')
    .setDescription(
      'Books a service bay and a qualified technician for the whole service duration ' +
        '(Keyloop Technical Assessment, Scenario A). Times are ISO 8601; requests must carry ' +
        'an explicit offset. Errors are RFC 9457 problem details with a stable `code`.',
    )
    .setVersion(API_VERSION)
    .addTag('appointments', 'Book, read and cancel service appointments')
    .addTag('availability', 'Free start times for a service on a local date')
    .addTag('operations', 'Health checks and metrics')
    .build();
  return SwaggerModule.createDocument(app, config);
}
