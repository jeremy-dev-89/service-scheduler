import { requestFingerprint, validIdempotencyKey } from '../../src/api/idempotency';
import { ValidationFailedError } from '../../src/domain/errors';

describe('requestFingerprint', () => {
  it('ignores key order at every level', () => {
    expect(requestFingerprint({ a: 1, b: { c: 2, d: [3, { e: 4, f: 5 }] } })).toBe(
      requestFingerprint({ b: { d: [3, { f: 5, e: 4 }], c: 2 }, a: 1 }),
    );
  });

  it('changes when any value changes', () => {
    expect(requestFingerprint({ startsAt: '2026-10-13T10:00:00+01:00' })).not.toBe(
      requestFingerprint({ startsAt: '2026-10-13T09:00:00Z' }),
    );
  });

  it('is a SHA-256 hex digest', () => {
    expect(requestFingerprint({})).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('validIdempotencyKey', () => {
  it('accepts no header and keys of 1 to 128 characters', () => {
    expect(validIdempotencyKey(undefined)).toBeUndefined();
    expect(validIdempotencyKey('k')).toBe('k');
    expect(validIdempotencyKey('k'.repeat(128))).toHaveLength(128);
  });

  it('rejects an empty or overlong key', () => {
    expect(() => validIdempotencyKey('')).toThrow(ValidationFailedError);
    expect(() => validIdempotencyKey('k'.repeat(129))).toThrow(ValidationFailedError);
  });
});
