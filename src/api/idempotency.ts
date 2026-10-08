import { createHash } from 'node:crypto';
import { ValidationFailedError } from '../domain/errors';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

const MAX_KEY_LENGTH = 128;

/** JSON with object keys sorted at every level, so key order never changes the result. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 of the request body as canonical JSON. */
export function requestFingerprint(body: object): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

/** Returns the key if the header was sent, after checking it is 1–128 characters. */
export function validIdempotencyKey(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  if (header.length === 0 || header.length > MAX_KEY_LENGTH) {
    throw new ValidationFailedError([
      {
        field: IDEMPOTENCY_KEY_HEADER,
        message: `${IDEMPOTENCY_KEY_HEADER} must be 1 to ${MAX_KEY_LENGTH} characters`,
      },
    ]);
  }
  return header;
}
