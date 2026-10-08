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

The application reads candidates without locks and treats a single autocommit `INSERT … ON CONFLICT DO NOTHING` as the decision, with the exclusion constraints and the idempotency index as arbiters. When the insert writes nothing, a follow-up read tells the use case which resource the winning row holds; it excludes that resource and tries the next candidate pair, at most `BOOKING_MAX_ATTEMPTS` times.

### Revision, 8 Oct 2026: from plain INSERT to ON CONFLICT DO NOTHING

The first implementation used a plain `INSERT` and read the 23P01 constraint name. Stress-running the concurrency tests showed this livelocks. An exclusion check inserts its own index entry *before* looking for conflicts, so two concurrent conflicting inserts wait on each other and PostgreSQL must abort one as a deadlock victim (40P01). With many requests racing for one slot, whichever insert survives meets a newcomer:

- A plain-SQL probe of 16 racing inserts per round managed 96 rounds in 240 s, with rounds stalling for up to 96 s.
- In one CT-01 run, 50 requests produced about 23 deadlock aborts per second for 33 s with no commit at all.
- Short `lock_timeout` values aborted every member of a wait cycle at once and made it worse.

`INSERT … ON CONFLICT DO NOTHING` uses speculative insertion: it checks for conflicts before inserting, and when two speculative inserters still meet, only the older one waits. The same probe ran 38,172 rounds in 60 s at 16 inserts per round, and 18,522 rounds at 50, with no errors, no deadlocks and never more rows than the resources allow. Exclusion constraints are supported as arbiters for `DO NOTHING`.

The guarantee is unchanged: the constraints decide and the insert is one autocommit statement. What changed is the signal: "no row" plus a read of which committed row holds the resource, instead of the 23P01 constraint name. If that read finds nothing (the winner was cancelled meanwhile), the insert is retried. As defence in depth the pool sets `lock_timeout = 2s`, and aborted statements (40P01, 55P03) are retried with jittered exponential backoff under their own bound.

## Alternatives considered

- **Row locks (`SELECT … FOR UPDATE`)** on bays and technicians. Correct only if every code path takes the locks in the same order; a forgotten lock or a new write path silently reintroduces double booking. Locks are held across several round trips, which lowers throughput and invites deadlocks.
- **SERIALIZABLE isolation.** Correct, but conflicts surface as generic `40001` serialization failures that do not say which resource was contended, so the retry cannot exclude the right bay or technician. Every transaction pays the predicate-lock cost, and the guarantee depends on every writer using the same isolation level.
- **Advisory locks** keyed by dealership or resource. Cheap, but purely cooperative: the database does not stop a writer that skips the lock, and a coarse key serialises unrelated bookings.

## Consequences

- The invariant holds for every writer, including future code paths, scripts and manual SQL.
- Conflicts are reported per resource, which makes bounded, targeted retries possible.
- The application availability checks become optimisations, not the guarantee; the concurrency tests (CT-01 to CT-03) prove the constraints decide the race. Dropping the bay and technician constraints in the test database makes CT-01 confirm 16 bookings for one bay.
- The design depends on PostgreSQL-specific features (`tstzrange`, `btree_gist`, exclusion constraints). This is acceptable for a single-region service and is recorded as a portability cost.
