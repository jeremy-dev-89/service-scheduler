# Review checklist

Used by me, and by the `reviewer` subagent (`.claude/agents/reviewer.md`), after every implementation step.

## Requirements
- [ ] The change meets the guide's spec for this step, including error codes and status codes.
- [ ] Nothing from the guide's out-of-scope list was built.

## Concurrency
- [ ] No check-then-insert reliance: the INSERT is the decision.
- [ ] `23P01` handled per constraint (bay, technician, vehicle); `23505` on the idempotency index handled.
- [ ] Retries bounded by `BOOKING_MAX_ATTEMPTS`; no `FOR UPDATE`, advisory locks or SERIALIZABLE.

## Time
- [ ] UTC storage; half-open `[start, end)` periods.
- [ ] Opening hours evaluated in the dealership's IANA zone; DST cases covered by tests.
- [ ] Business rules read time from the `Clock` port only.

## Architecture
- [ ] Layer import rules respected (`npm run lint` is clean).
- [ ] No SQL outside `src/infrastructure`; parameterised SQL only.

## Tests
- [ ] Every new behaviour has a test named by its ID.
- [ ] Assertions are meaningful: could a wrong implementation pass?
- [ ] No locked test in `test/acceptance` or `test/concurrency` changed without approval.

## Security and privacy
- [ ] Input validated at the API boundary.
- [ ] No names, emails, phone numbers or VINs in logs; responses expose only what the spec shows.

## Observability
- [ ] New paths emit the specified logs and metrics; metric labels contain no IDs.
