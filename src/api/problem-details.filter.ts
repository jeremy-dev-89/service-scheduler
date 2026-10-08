import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  DomainError,
  type ErrorCode,
  SlotUnavailableError,
  ValidationFailedError,
  type ValidationIssue,
} from '../domain/errors';
import { assignRequestId } from './request-id';

/** RFC 9457 problem details, with the stable `code` clients switch on. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  instance: string;
  requestId: string;
  errors?: readonly ValidationIssue[];
  alternatives?: readonly string[];
}

/** Status and title for every error code in the API specification. */
export const PROBLEM_CATALOGUE: Readonly<Record<ErrorCode, { status: number; title: string }>> = {
  VALIDATION_FAILED: { status: 400, title: 'Request validation failed' },
  DEALERSHIP_NOT_FOUND: { status: 404, title: 'Dealership not found' },
  CUSTOMER_NOT_FOUND: { status: 404, title: 'Customer not found' },
  VEHICLE_NOT_FOUND: { status: 404, title: 'Vehicle not found' },
  SERVICE_TYPE_NOT_FOUND: { status: 404, title: 'Service type not found' },
  APPOINTMENT_NOT_FOUND: { status: 404, title: 'Appointment not found' },
  VEHICLE_NOT_OWNED_BY_CUSTOMER: { status: 422, title: 'Vehicle does not belong to the customer' },
  START_IN_PAST: { status: 422, title: 'Start time is not in the future' },
  BEYOND_BOOKING_HORIZON: { status: 422, title: 'Start time is beyond the booking horizon' },
  OUTSIDE_OPENING_HOURS: { status: 422, title: 'Outside opening hours' },
  SLOT_UNAVAILABLE: { status: 409, title: 'Requested slot is unavailable' },
  VEHICLE_ALREADY_BOOKED: { status: 409, title: 'Vehicle already booked' },
  IDEMPOTENCY_KEY_REUSED: { status: 422, title: 'Idempotency key reused with a different body' },
  INTERNAL_ERROR: { status: 500, title: 'Internal server error' },
};

export const problemType = (code: string): string =>
  `/problems/${code.toLowerCase().replaceAll('_', '-')}`;

type Problem = Omit<ProblemDetails, 'instance' | 'requestId'>;

/**
 * Turns every error into application/problem+json. Domain errors keep their code;
 * framework HTTP errors keep their status; anything else is a 500 INTERNAL_ERROR,
 * logged with the request ID. Stack traces never reach the client.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = assignRequestId(request, response);
    const problem = this.toProblem(exception);

    if (problem.status >= 500) {
      const error = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(
        `Unhandled ${error.name} for request ${requestId}: ${error.message}`,
        error.stack,
      );
    }
    if (response.headersSent) {
      return;
    }

    const { errors, alternatives, ...core } = problem;
    const body: ProblemDetails = {
      ...core,
      instance: request.originalUrl.split('?')[0] ?? request.originalUrl,
      requestId,
      ...(errors ? { errors } : {}),
      ...(alternatives && alternatives.length > 0 ? { alternatives } : {}),
    };
    response.status(problem.status).type('application/problem+json').json(body);
  }

  private toProblem(exception: unknown): Problem {
    if (exception instanceof DomainError) {
      return {
        ...this.fromCode(exception.code, exception.message),
        ...(exception instanceof ValidationFailedError ? { errors: exception.errors } : {}),
        ...(exception instanceof SlotUnavailableError
          ? { alternatives: exception.alternatives }
          : {}),
      };
    }
    if (exception instanceof BadRequestException) {
      // Raised by the framework before validation, for example on a malformed JSON body.
      return {
        ...this.fromCode('VALIDATION_FAILED', 'The request could not be parsed.'),
        errors: [{ field: 'body', message: exception.message }],
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const name: string | undefined = HttpStatus[status];
      const code = name ?? 'HTTP_ERROR';
      return {
        type: problemType(code),
        title: exception.message,
        status,
        code,
        detail: exception.message,
      };
    }
    return this.fromCode('INTERNAL_ERROR', 'An unexpected error occurred.');
  }

  private fromCode(code: ErrorCode, detail: string): Problem {
    const { status, title } = PROBLEM_CATALOGUE[code];
    return { type: problemType(code), title, status, code, detail };
  }
}
