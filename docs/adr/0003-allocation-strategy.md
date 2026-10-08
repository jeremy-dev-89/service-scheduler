# ADR-003: Allocation strategy

- Status: Accepted
- Date: 2026-10-08

## Context

When several bays and qualified technicians are free for a requested period, the service must choose one bay and one technician. Bays are interchangeable within a dealership (AS4), and the brief does not ask for load balancing or utilisation optimisation.

## Decision

First-fit in a stable order (AS9): order free qualified technicians by `name`, then `id`, and free bays by `name`, then `id`. `nextCandidatePair` returns the first technician not excluded, paired with the first bay not excluded. When an insert loses a race on a bay or technician, that resource is excluded and the next pair is tried.

## Alternatives considered

- **Least-loaded technician** (fewest bookings that day). Fairer workload, but needs an extra aggregate query per booking and makes results harder to predict in tests.
- **Random choice.** Spreads contention between concurrent requests, but makes behaviour non-deterministic and tests flaky.
- **Best-fit** (choose the resource whose free gap fits the service most tightly). Reduces fragmentation of the day, but is more complex and its benefit is unproven at this scale.

## Consequences

- Allocation is deterministic, which keeps acceptance tests and demos reproducible.
- Under contention, concurrent requests all try the same first pair, so losers retry; retries are bounded and counted by `booking_conflict_retries_total`.
- Earlier-named technicians and bays receive more work. A smarter strategy can replace `nextCandidatePair` without touching the persistence or API layers.
