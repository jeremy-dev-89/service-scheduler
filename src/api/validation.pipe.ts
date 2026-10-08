import { ParseUUIDPipe, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { ValidationFailedError, type ValidationIssue } from '../domain/errors';

function flatten(errors: ValidationError[], parent = ''): ValidationIssue[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => ({ field, message }));
    return [...own, ...flatten(error.children ?? [], field)];
  });
}

/** Rejects unknown or invalid fields with 400 VALIDATION_FAILED and a list of issues. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new ValidationFailedError(flatten(errors)),
  });
}

/** A path parameter that must be a UUID. */
export function uuidParam(name: string): ParseUUIDPipe {
  return new ParseUUIDPipe({
    exceptionFactory: () =>
      new ValidationFailedError([{ field: name, message: `${name} must be a UUID` }]),
  });
}
