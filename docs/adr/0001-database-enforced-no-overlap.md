# ADR-001: Database-enforced no-overlap

- Status: Accepted
- Date: 2026-10-08

## Context

Requirement A2 says a booking may only be confirmed when a service bay and a qualified technician are both free for the entire service duration. The service is stateless and may run as several instances, so two requests for the same slot can be processed at the same moment by different processes. Any "check availability, then insert" sequence in application code has a race window between the check and the insert.

## Decision

PostgreSQL enforces the no-overlap rule. The `appointment` table stores the booked time as a half-open `tstzrange` and carries three partial exclusion constraints (`btree_gist`):

- `appointment_no_bay_overlap`: `service_bay_id WITH =, period WITH &&` where `status = 'CONFIRMED'`
- `appointment_no_technician_overlap`: `technician_id WITH =, period WITH &&` where `status = 'CONFIRMED'`
- `appointment_no_vehicle_overlap`: `vehicle_id WITH =, period WITH &&` where `status = 'CONFIRMED'`

The application reads candidates without locks and treats the single autocommit `INSERT` as the decision. When the insert fails with SQLSTATE `23P01`, the constraint name tells the use case which resource was taken; it excludes that resource and tries the next candidate pair, at most `BOOKING_MAX_ATTEMPTS` times.

## Alternatives considered

- **Row locks (`SELECT … FOR UPDATE`)** on bays and technicians. Correct only if every code path takes the locks in the same order; a forgotten lock or a new write path silently reintroduces double booking. Locks are held across several round trips, which lowers throughput and invites deadlocks.
- **SERIALIZABLE isolation.** Correct, but conflicts surface as generic `40001` serialization failures that do not say which resource was contended, so the retry cannot exclude the right bay or technician. Every transaction pays the predicate-lock cost, and the guarantee depends on every writer using the same isolation level.
- **Advisory locks** keyed by dealership or resource. Cheap, but purely cooperative: the database does not stop a writer that skips the lock, and a coarse key serialises unrelated bookings.

## Consequences

- The invariant holds for every writer, including future code paths, scripts and manual SQL.
- Conflicts are reported per resource, which makes bounded, targeted retries possible.
- The application availability checks become optimisations, not the guarantee; the concurrency tests (CT-01 to CT-03) prove the constraints decide the race.
- The design depends on PostgreSQL-specific features (`tstzrange`, `btree_gist`, exclusion constraints). This is acceptable for a single-region service and is recorded as a portability cost.
